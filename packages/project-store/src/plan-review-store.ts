import {
  ApprovePlanReviewInputSchema,
  UpdateDraftShotPlanInputSchema,
  type ApprovePlanReviewInput,
  type PlanReview,
  type ScriptCompilation,
  type ShotPlan,
  type UpdateDraftShotPlanInput,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { StoreError } from './errors.js';
import { requireGenerationUnlocked } from './generation-locks.js';
import { parseInput } from './input.js';
import { mapProject, mapScriptCompilation, mapShotPlan } from './row-mappers.js';
import { buildPlanReview } from './plan-review-projection.js';

const editableColumns = {
  title: 'title',
  duration_seconds: 'duration_seconds',
  shot_size: 'shot_size',
  camera_movement: 'camera_movement',
  action: 'action',
  dialogue: 'dialogue',
  prompt: 'prompt',
  costume_state: 'costume_state_json',
  position_state: 'position_state_json',
  prop_state: 'prop_state_json',
} as const;

type EditableField = keyof typeof editableColumns;

export class PlanReviewStore {
  constructor(private readonly database: Database.Database) {}

  get(projectId: string, scriptVersionId: string): PlanReview {
    return this.buildReview(projectId, scriptVersionId);
  }

  updateShot(projectId: string, scriptVersionId: string, shotPlanId: string,
    rawInput: UpdateDraftShotPlanInput): PlanReview {
    const input = parseInput(UpdateDraftShotPlanInputSchema, rawInput);
    return this.database.transaction(() => {
      requireGenerationUnlocked(this.database, projectId);
      const compilation = this.requireCompilation(projectId, scriptVersionId);
      this.requireCurrentScript(projectId, scriptVersionId);
      if (compilation.status !== 'draft') throw new StoreError(
        'PLAN_REVIEW_IMMUTABLE', 'Approved or superseded plans cannot be edited',
        { compilation_id: compilation.id, status: compilation.status });
      if (compilation.revision !== input.expected_compilation_revision) {
        throw this.conflict(compilation, input.expected_compilation_revision);
      }
      const shot = this.requireCompilationShot(compilation.id, shotPlanId);
      if (shot.planning_status !== 'draft') throw new StoreError(
        'PLAN_REVIEW_IMMUTABLE', 'Only a draft ShotPlan can be edited',
        { shot_plan_id: shot.id, status: shot.planning_status });
      if (shot.planning_revision !== input.expected_planning_revision) {
        throw new StoreError('PLAN_REVIEW_CONFLICT',
          'ShotPlan changed after this review loaded it', {
            shot_plan_id: shot.id,
            expected_planning_revision: input.expected_planning_revision,
            current_planning_revision: shot.planning_revision,
          });
      }
      const now = new Date().toISOString();
      const setters = ['planning_revision = planning_revision + 1',
        'updated_at = ?'];
      const values: unknown[] = [now];
      for (const field of Object.keys(editableColumns) as EditableField[]) {
        const value = input[field];
        if (value === undefined) continue;
        setters.push(`${editableColumns[field]} = ?`);
        values.push(typeof value === 'object' ? JSON.stringify(value) : value);
      }
      const shotClaim = this.database.prepare(`UPDATE shot_plans SET
        ${setters.join(', ')} WHERE id = ? AND source_compilation_id = ?
        AND planning_status = 'draft' AND planning_revision = ?`).run(
        ...values, shotPlanId, compilation.id,
        input.expected_planning_revision);
      const compilationClaim = this.database.prepare(`UPDATE script_compilations
        SET revision = revision + 1 WHERE id = ? AND status = 'draft'
        AND revision = ?`).run(compilation.id,
        input.expected_compilation_revision);
      if (shotClaim.changes !== 1 || compilationClaim.changes !== 1) {
        throw this.conflict(compilation, input.expected_compilation_revision);
      }
      this.database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
        .run(now, projectId);
      return this.buildReview(projectId, scriptVersionId);
    }).immediate();
  }

  approve(projectId: string, scriptVersionId: string,
    rawInput: ApprovePlanReviewInput): PlanReview {
    const input = parseInput(ApprovePlanReviewInputSchema, rawInput);
    return this.database.transaction(() => {
      const compilation = this.requireCompilation(projectId, scriptVersionId);
      const project = this.getProject(projectId);
      if (compilation.status === 'approved' &&
        project.active_script_compilation_id === compilation.id) {
        if (input.expected_revision !== compilation.revision - 1) {
          throw this.conflict(compilation, input.expected_revision);
        }
        return this.buildReview(projectId, scriptVersionId);
      }
      requireGenerationUnlocked(this.database, projectId);
      this.assertCurrentScript(project, scriptVersionId);
      if (compilation.status !== 'draft') throw new StoreError(
        'PLAN_REVIEW_IMMUTABLE', 'Only a draft plan set can be approved',
        { compilation_id: compilation.id, status: compilation.status });
      if (compilation.revision !== input.expected_revision) {
        throw this.conflict(compilation, input.expected_revision);
      }
      const readiness = this.buildReview(projectId, scriptVersionId);
      if (!readiness.can_approve) throw new StoreError(
        'PLAN_REVIEW_INCOMPLETE',
        'The draft plan set has incomplete Scene/Beat provenance', {
          compilation_id: compilation.id,
        });
      const counts = this.database.prepare(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN planning_status = 'draft' THEN 1 ELSE 0 END) AS drafts
        FROM shot_plans WHERE source_compilation_id = ?`).get(compilation.id) as
        { total: number; drafts: number | null };
      if (counts.total !== compilation.shot_count ||
        counts.drafts !== compilation.shot_count) throw new StoreError(
        'PLAN_REVIEW_INCOMPLETE', 'The compiled plan set is incomplete', {
          compilation_id: compilation.id,
          expected_shot_count: compilation.shot_count,
          actual_shot_count: counts.total,
          draft_shot_count: counts.drafts ?? 0,
        });
      const now = new Date().toISOString();
      this.database.prepare(`UPDATE shot_plans SET planning_status = 'superseded',
        updated_at = ? WHERE project_id = ? AND planning_status = 'approved'
        AND source_compilation_id IS NOT ?`).run(now, projectId, compilation.id);
      this.database.prepare(`UPDATE script_compilations SET
        status = 'superseded', superseded_at = ? WHERE project_id = ?
        AND status = 'approved' AND id != ?`).run(now, projectId, compilation.id);
      this.database.prepare(`UPDATE shot_plans SET planning_status = 'approved',
        updated_at = ? WHERE source_compilation_id = ?
        AND planning_status = 'draft'`).run(now, compilation.id);
      const claimed = this.database.prepare(`UPDATE script_compilations SET
        status = 'approved', revision = revision + 1, approved_at = ?
        WHERE id = ? AND status = 'draft' AND revision = ?`).run(
        now, compilation.id, input.expected_revision);
      if (claimed.changes !== 1) {
        throw this.conflict(compilation, input.expected_revision);
      }
      this.database.prepare(`UPDATE projects SET
        active_script_compilation_id = ?, updated_at = ? WHERE id = ?`).run(
        compilation.id, now, projectId);
      return this.buildReview(projectId, scriptVersionId);
    }).immediate();
  }

  private buildReview(projectId: string, scriptVersionId: string): PlanReview {
    const compilation = this.requireCompilation(projectId, scriptVersionId);
    return buildPlanReview(this.database, projectId, scriptVersionId, compilation);
  }

  private requireCompilation(projectId: string,
    scriptVersionId: string): ScriptCompilation {
    const row = this.database.prepare(`SELECT * FROM script_compilations
      WHERE project_id = ? AND script_version_id = ?`).get(
      projectId, scriptVersionId);
    if (!row) throw new StoreError('PLAN_REVIEW_NOT_FOUND',
      'This script has not been compiled into a reviewable plan set', {
        project_id: projectId, script_version_id: scriptVersionId,
      });
    return mapScriptCompilation(row);
  }

  private requireCurrentScript(projectId: string, scriptVersionId: string) {
    const project = this.getProject(projectId);
    this.assertCurrentScript(project, scriptVersionId);
    return project;
  }

  private getProject(projectId: string) {
    const row = this.database.prepare('SELECT * FROM projects WHERE id = ?')
      .get(projectId);
    if (!row) throw new StoreError('PROJECT_NOT_FOUND',
      'Project does not exist', { project_id: projectId });
    return mapProject(row);
  }

  private assertCurrentScript(project: ReturnType<typeof mapProject>,
    scriptVersionId: string): void {
    if (project.active_script_version_id !== scriptVersionId) {
      throw new StoreError('PLAN_REVIEW_SCRIPT_STALE',
        'Only the active locked script plan set can change', {
          project_id: project.id, script_version_id: scriptVersionId,
          active_script_version_id: project.active_script_version_id,
        });
    }
  }

  private requireCompilationShot(compilationId: string,
    shotPlanId: string): ShotPlan {
    const row = this.database.prepare(`SELECT * FROM shot_plans
      WHERE id = ? AND source_compilation_id = ?`).get(
      shotPlanId, compilationId);
    if (!row) throw new StoreError('PLAN_REVIEW_SHOT_MISMATCH',
      'ShotPlan does not belong to this compilation', {
        compilation_id: compilationId, shot_plan_id: shotPlanId,
      });
    return mapShotPlan(row);
  }

  private conflict(compilation: ScriptCompilation, expected: number): StoreError {
    return new StoreError('PLAN_REVIEW_CONFLICT',
      'Plan review changed after this editor loaded it', {
        compilation_id: compilation.id,
        expected_revision: expected,
        current_revision: compilation.revision,
      });
  }
}
