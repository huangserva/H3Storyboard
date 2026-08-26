import {
  PlanReviewSchema,
  type PlanReview,
  type ScriptCompilation,
  type ShotPlan,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { StoreError } from './errors.js';
import { diffPlanSets } from './plan-review-diff.js';
import { mapProject, mapShotPlan } from './row-mappers.js';
import { getScriptDocument } from './script-persistence.js';

export function buildPlanReview(database: Database.Database, projectId: string,
  scriptVersionId: string, compilation: ScriptCompilation): PlanReview {
  const projectRow = database.prepare('SELECT * FROM projects WHERE id = ?')
    .get(projectId);
  if (!projectRow) throw new StoreError(
    'PROJECT_NOT_FOUND', 'Project does not exist', { project_id: projectId });
  const project = mapProject(projectRow);
  const document = getScriptDocument(database, projectId, scriptVersionId);
  const shots = shotsForCompilation(database, compilation.id);
  const baseline = project.active_script_compilation_id === compilation.id ?
    shots : project.active_script_compilation_id === null ?
      approvedShots(database, projectId) :
      shotsForCompilation(database, project.active_script_compilation_id);
  const diff = diffPlanSets(shots, baseline);
  const scenes = new Map(document.scenes.map((scene) => [scene.id, scene]));
  const items = shots.map((shot) => {
    const scene = shot.source_script_scene_id === null ? undefined :
      scenes.get(shot.source_script_scene_id);
    if (!scene) throw new StoreError('DATABASE_RECORD_INVALID',
      'Compiled ShotPlan source scene is missing', { shot_plan_id: shot.id });
    const beatIds = new Set(shot.source_script_beat_ids);
    const { beats, ...sourceScene } = scene;
    return {
      shot_plan: shot,
      source_scene: sourceScene,
      source_beats: beats.filter(({ id }) => beatIds.has(id)),
      change: diff.changes.get(shot.id)!,
    };
  });
  return PlanReviewSchema.parse({
    compilation,
    active_compilation_id: project.active_script_compilation_id,
    items,
    removed_shot_plans: diff.removed,
    can_approve: compilation.status === 'draft' &&
      project.active_script_version_id === scriptVersionId &&
      items.length === compilation.shot_count &&
      items.every(({ shot_plan, source_beats }) =>
        shot_plan.planning_status === 'draft' &&
        source_beats.length === shot_plan.source_script_beat_ids.length &&
        source_beats.every(({ id }, index) =>
          id === shot_plan.source_script_beat_ids[index])),
  });
}

function shotsForCompilation(database: Database.Database,
  compilationId: string): ShotPlan[] {
  return database.prepare(`SELECT * FROM shot_plans
    WHERE source_compilation_id = ? ORDER BY ordinal`).all(compilationId)
    .map(mapShotPlan);
}

function approvedShots(database: Database.Database,
  projectId: string): ShotPlan[] {
  return database.prepare(`SELECT * FROM shot_plans
    WHERE project_id = ? AND planning_status = 'approved' ORDER BY ordinal`)
    .all(projectId).map(mapShotPlan);
}
