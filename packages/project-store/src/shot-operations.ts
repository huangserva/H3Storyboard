import {
  CreateShotActualInputSchema,
  CreateShotPlanInputSchema,
  ReviewShotActualInputSchema,
  type CreateShotActualInput,
  type CreateShotPlanInput,
  type ReviewShotActualInput,
  type ShotActual,
  type ShotPlan,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { StoreError } from './errors.js';
import { parseInput } from './input.js';
import { mapShotActual, mapShotPlan } from './row-mappers.js';
import {
  requireProject,
  requireShot,
  validateAssetBindings,
  validateContinuityDependencies,
} from './store-guards.js';

export function createShotPlan(
  db: Database.Database,
  projectId: string,
  rawInput: CreateShotPlanInput,
): ShotPlan {
  const input = parseInput(CreateShotPlanInputSchema, rawInput);
  return db.transaction(() => {
    const project = requireProject(db, projectId);
    validateAssetBindings(db, projectId, input.reference_bindings);
    validateContinuityDependencies(
      db,
      projectId,
      input.continuity_mode,
      input.continuity_dependencies,
    );
    const ordinalRow = db
      .prepare(
        'SELECT COALESCE(MAX(ordinal), 0) + 1 AS ordinal FROM shot_plans WHERE project_id = ?',
      )
      .get(projectId) as { ordinal: number };
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO shot_plans
       (id, project_id, script_version_id, ordinal, title, scene_id,
        duration_seconds, shot_size, camera_movement, action, dialogue, sound,
        prompt, continuity_mode, continuity_dependencies_json,
        costume_state_json, reference_bindings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      projectId,
      project.active_script_version_id,
      ordinalRow.ordinal,
      input.title,
      input.scene_id,
      input.duration_seconds,
      input.shot_size,
      input.camera_movement,
      input.action,
      input.dialogue,
      input.sound,
      input.prompt,
      input.continuity_mode,
      JSON.stringify(input.continuity_dependencies),
      JSON.stringify(input.costume_state),
      JSON.stringify(input.reference_bindings),
      now,
      now,
    );
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(
      now,
      projectId,
    );
    return mapShotPlan(
      db.prepare('SELECT * FROM shot_plans WHERE id = ?').get(id),
    );
  })();
}

export function createShotActual(
  db: Database.Database,
  shotPlanId: string,
  rawInput: CreateShotActualInput,
): ShotActual {
  const input = parseInput(CreateShotActualInputSchema, rawInput);
  if (input.qc_verdict !== 'pending') {
    throw new StoreError(
      'QC_VERDICT_INVALID',
      'New generated takes must begin with a pending QC verdict',
    );
  }
  return db.transaction(() => {
    const shot = requireShot(db, shotPlanId);
    const existing = db
      .prepare('SELECT * FROM shot_actuals WHERE job_id = ?')
      .get(input.job_id);
    if (existing) {
      const actual = mapShotActual(existing);
      if (actual.shot_plan_id !== shotPlanId) {
        throw new StoreError(
          'H3_JOB_SHOT_MISMATCH',
          'H3 job already belongs to a take for another shot',
          { job_id: input.job_id, shot_plan_id: shotPlanId },
        );
      }
      if (actual.output_asset_id !== input.output_asset_id) {
        throw new StoreError(
          'H3_JOB_OUTPUT_MISMATCH',
          'Existing take has a different output asset',
          {
            job_id: input.job_id,
            output_asset_id: actual.output_asset_id,
            requested_output_asset_id: input.output_asset_id,
          },
        );
      }
      if (
        actual.observed_description !== input.observed_description ||
        actual.deviation_notes !== input.deviation_notes ||
        actual.qc_verdict !== input.qc_verdict
      ) {
        throw new StoreError(
          'SHOT_ACTUAL_CONFLICT',
          'H3 job already has a take with different observed data',
          { job_id: input.job_id, shot_actual_id: actual.id },
        );
      }
      return actual;
    }

    const job = db
      .prepare(
        `SELECT project_id, shot_plan_id, status, output_asset_id
         FROM h3_jobs WHERE id = ?`,
      )
      .get(input.job_id) as
      | {
          project_id: string;
          shot_plan_id: string;
          status: string;
          output_asset_id: string | null;
        }
      | undefined;
    if (!job) {
      throw new StoreError('H3_JOB_NOT_FOUND', 'H3 job does not exist', {
        job_id: input.job_id,
      });
    }
    if (job.project_id !== shot.project_id || job.shot_plan_id !== shotPlanId) {
      throw new StoreError(
        'H3_JOB_SHOT_MISMATCH',
        'H3 job does not belong to this shot',
        { job_id: input.job_id, shot_plan_id: shotPlanId },
      );
    }
    if (job.status !== 'completed') {
      throw new StoreError(
        'H3_JOB_NOT_COMPLETED',
        'Only a completed job can become a take',
        { job_id: input.job_id, status: job.status },
      );
    }
    if (job.output_asset_id !== input.output_asset_id) {
      throw new StoreError(
        'H3_JOB_OUTPUT_MISMATCH',
        'Take asset does not match the job output',
        { job_id: input.job_id, output_asset_id: input.output_asset_id },
      );
    }
    const attemptRow = db
      .prepare(
        `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS attempt_number
         FROM shot_actuals WHERE shot_plan_id = ?`,
      )
      .get(shotPlanId) as { attempt_number: number };
    const id = randomUUID();
    const now = new Date().toISOString();
    const reviewedAt = input.qc_verdict === 'pending' ? null : now;
    db.prepare(
      `INSERT INTO shot_actuals
       (id, project_id, shot_plan_id, job_id, output_asset_id, attempt_number,
        observed_description, deviation_notes, qc_verdict, created_at, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      shot.project_id,
      shotPlanId,
      input.job_id,
      input.output_asset_id,
      attemptRow.attempt_number,
      input.observed_description,
      input.deviation_notes,
      input.qc_verdict,
      now,
      reviewedAt,
    );
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(
      now,
      shot.project_id,
    );
    return mapShotActual(
      db.prepare('SELECT * FROM shot_actuals WHERE id = ?').get(id),
    );
  })();
}

export function reviewShotActual(
  db: Database.Database,
  actualId: string,
  rawInput: ReviewShotActualInput,
): ShotActual {
  const input = parseInput(ReviewShotActualInputSchema, rawInput);
  return db.transaction(() => {
    const row = db
      .prepare('SELECT * FROM shot_actuals WHERE id = ?')
      .get(actualId);
    if (!row) {
      throw new StoreError(
        'SHOT_ACTUAL_NOT_FOUND',
        'Generated take does not exist',
        { shot_actual_id: actualId },
      );
    }
    const actual = mapShotActual(row);
    if (
      actual.qc_verdict !== 'pending' ||
      !['approved', 'rejected'].includes(input.qc_verdict)
    ) {
      throw new StoreError(
        'QC_VERDICT_INVALID',
        'A pending take may be reviewed exactly once',
        { shot_actual_id: actualId, qc_verdict: actual.qc_verdict },
      );
    }
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE shot_actuals
       SET qc_verdict = ?, deviation_notes = ?, reviewed_at = ? WHERE id = ?`,
    ).run(
      input.qc_verdict,
      input.deviation_notes ?? actual.deviation_notes,
      now,
      actualId,
    );
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(
      now,
      actual.project_id,
    );
    return mapShotActual(
      db.prepare('SELECT * FROM shot_actuals WHERE id = ?').get(actualId),
    );
  })();
}
