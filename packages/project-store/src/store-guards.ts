import {
  validateH3Bindings,
  type AssetBinding,
  type ContinuityDependency,
  type H3Mode,
  type ShotPlan,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { StoreError } from './errors.js';
import { mapShotPlan } from './row-mappers.js';

interface ProjectRow {
  id: string;
  active_script_version_id: string;
  script_status: string;
}

export function requireProject(
  db: Database.Database,
  projectId: string,
): ProjectRow {
  const row = db
    .prepare(
      `SELECT p.id, p.active_script_version_id, s.status AS script_status
       FROM projects p
       LEFT JOIN script_versions s ON s.id = p.active_script_version_id
       WHERE p.id = ?`,
    )
    .get(projectId) as ProjectRow | undefined;
  if (!row) {
    throw new StoreError('PROJECT_NOT_FOUND', 'Project does not exist', {
      project_id: projectId,
    });
  }
  if (row.script_status !== 'locked') {
    throw new StoreError(
      row.script_status ? 'SCRIPT_NOT_LOCKED' : 'SCRIPT_VERSION_NOT_FOUND',
      'The active script must exist and be locked',
      { project_id: projectId },
    );
  }
  return row;
}

export function requireShot(
  db: Database.Database,
  shotPlanId: string,
): ShotPlan {
  const row = db
    .prepare('SELECT * FROM shot_plans WHERE id = ?')
    .get(shotPlanId);
  if (!row) {
    throw new StoreError('SHOT_PLAN_NOT_FOUND', 'Shot plan does not exist', {
      shot_plan_id: shotPlanId,
    });
  }
  return mapShotPlan(row);
}

export function validateContinuityJobBindings(
  shot: ShotPlan,
  bindings: readonly AssetBinding[],
): void {
  if (shot.continuity_mode === 'independent') return;

  const requiredAssetIds = new Set(
    shot.continuity_dependencies.map(({ reference_asset_id }) =>
      reference_asset_id,
    ),
  );
  const missingBindings = shot.reference_bindings.filter(
    (planned) =>
      requiredAssetIds.has(planned.asset_id) &&
      !bindings.some(
        (submitted) =>
          submitted.asset_id === planned.asset_id &&
          submitted.asset_kind === planned.asset_kind &&
          submitted.role === planned.role &&
          submitted.ordinal === planned.ordinal,
      ),
  );
  if (missingBindings.length > 0) {
    throw new StoreError(
      'H3_BINDINGS_INVALID',
      'H3 input must include every planned continuity reference binding',
      {
        shot_plan_id: shot.id,
        missing_bindings: missingBindings,
      },
    );
  }
}

export function validateAssetBindings(
  db: Database.Database,
  projectId: string,
  bindings: readonly AssetBinding[],
): void {
  const findAsset = db.prepare(
    'SELECT project_id, kind FROM assets WHERE id = ?',
  );
  for (const binding of bindings) {
    const asset = findAsset.get(binding.asset_id) as
      | { project_id: string; kind: string }
      | undefined;
    if (!asset) {
      throw new StoreError('ASSET_NOT_FOUND', 'Bound asset does not exist', {
        asset_id: binding.asset_id,
      });
    }
    if (asset.project_id !== projectId) {
      throw new StoreError(
        'ASSET_PROJECT_MISMATCH',
        'Bound asset belongs to another project',
        { asset_id: binding.asset_id, project_id: projectId },
      );
    }
    if (asset.kind !== binding.asset_kind) {
      throw new StoreError(
        'ASSET_KIND_MISMATCH',
        'Binding kind does not match the persisted asset',
        {
          asset_id: binding.asset_id,
          binding_kind: binding.asset_kind,
          asset_kind: asset.kind,
        },
      );
    }
  }
}

export function validateJobBindings(
  db: Database.Database,
  projectId: string,
  mode: H3Mode,
  bindings: readonly AssetBinding[],
): void {
  const issues = validateH3Bindings(mode, [...bindings]);
  if (issues.length > 0) {
    throw new StoreError(
      'H3_BINDINGS_INVALID',
      'Reference bindings do not satisfy H3 requirements',
      { issues },
    );
  }
  validateAssetBindings(db, projectId, bindings);
}

export function validateContinuityDependencies(
  db: Database.Database,
  projectId: string,
  mode: 'independent' | 'visual_match' | 'chained',
  dependencies: readonly ContinuityDependency[],
): void {
  if (
    (mode === 'independent' && dependencies.length > 0) ||
    (mode !== 'independent' && dependencies.length === 0)
  ) {
    throw new StoreError(
      'CONTINUITY_DEPENDENCY_INVALID',
      'Continuity mode and dependencies disagree',
      { continuity_mode: mode, dependency_count: dependencies.length },
    );
  }

  const lookup = db.prepare(
    `SELECT source.project_id AS source_project_id,
            actual.shot_plan_id AS actual_shot_plan_id,
            actual.output_asset_id AS source_output_asset_id,
            actual.qc_verdict AS qc_verdict,
            asset.project_id AS reference_project_id,
            asset.kind AS reference_kind,
            asset.status AS reference_status,
            asset.derived_from_asset_id AS derived_from_asset_id,
            asset.derivation_kind AS derivation_kind
     FROM shot_plans source
     JOIN shot_actuals actual ON actual.id = ?
     JOIN assets asset ON asset.id = ?
     WHERE source.id = ?`,
  );
  const seen = new Set<string>();
  for (const dependency of dependencies) {
    const key = [
      dependency.source_shot_plan_id,
      dependency.source_take_id,
      dependency.reference_asset_id,
      dependency.boundary,
    ].join(':');
    const row = lookup.get(
      dependency.source_take_id,
      dependency.reference_asset_id,
      dependency.source_shot_plan_id,
    ) as
      | {
          source_project_id: string;
          actual_shot_plan_id: string;
          source_output_asset_id: string;
          qc_verdict: string;
          reference_project_id: string;
          reference_kind: string;
          reference_status: string;
          derived_from_asset_id: string | null;
          derivation_kind: string | null;
        }
      | undefined;
    const valid =
      !seen.has(key) &&
      row?.source_project_id === projectId &&
      row.actual_shot_plan_id === dependency.source_shot_plan_id &&
      row.qc_verdict === 'approved' &&
      row.reference_project_id === projectId &&
      row.reference_status !== 'archived' &&
      (dependency.boundary === 'full_video'
        ? row.reference_kind === 'video' &&
          row.source_output_asset_id === dependency.reference_asset_id
        : row.reference_kind === 'image' &&
          row.derived_from_asset_id === row.source_output_asset_id &&
          row.derivation_kind === dependency.boundary);
    if (!valid) {
      throw new StoreError(
        'CONTINUITY_DEPENDENCY_INVALID',
        'Continuity dependency must reference an approved take in this project',
        dependency,
      );
    }
    seen.add(key);
  }
}
