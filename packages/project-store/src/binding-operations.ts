import { compileBindings, BindingCompilerError,
  type CompileBindingsInput } from '@h3storyboard/h3-provider';
import type {
  Asset,
  CharacterReference,
  CompiledBindingsResult,
  ModeCapabilityDeclaration,
  ShotPlan,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { StoreError } from './errors.js';
import { mapAsset, mapCharacterReference, mapShotPlan } from './row-mappers.js';

interface BindingCompilationContext {
  readonly manifest_asset_ids: readonly string[];
  readonly assets: readonly Asset[];
  readonly character_references: readonly CharacterReference[];
  readonly capability: ModeCapabilityDeclaration;
}

export interface BindingCompilationOutcome {
  readonly shot_plan_id: string;
  readonly compiled: CompiledBindingsResult | null;
  readonly error: StoreError | null;
}

export function compileShotBindings(db: Database.Database,
  shotPlanId: string): CompiledBindingsResult {
  const shotRow = db.prepare(
    'SELECT * FROM shot_plans WHERE id = ?',
  ).get(shotPlanId);
  if (!shotRow) throw new StoreError(
    'SHOT_PLAN_NOT_FOUND', 'Shot plan does not exist', {
      shot_plan_id: shotPlanId,
    });
  const shot = mapShotPlan(shotRow);
  return compileShotWithContext(shot, bindingContext(db, shot.project_id));
}

export function compileProjectShotBindings(db: Database.Database,
  projectId: string, shotPlanIds: readonly string[]): BindingCompilationOutcome[] {
  const shots = new Map(db.prepare(
    'SELECT * FROM shot_plans WHERE project_id = ?',
  ).all(projectId).map(mapShotPlan).map((shot) => [shot.id, shot]));
  let context: BindingCompilationContext;
  try {
    context = bindingContext(db, projectId);
  } catch (error) {
    if (!(error instanceof StoreError)) throw error;
    return shotPlanIds.map((shotPlanId) => ({
      shot_plan_id: shotPlanId, compiled: null, error,
    }));
  }
  return shotPlanIds.map((shotPlanId) => {
    const shot = shots.get(shotPlanId);
    if (!shot) return { shot_plan_id: shotPlanId, compiled: null,
      error: new StoreError('SHOT_PLAN_NOT_FOUND', 'Shot plan does not exist', {
        shot_plan_id: shotPlanId,
      }) };
    try {
      return { shot_plan_id: shotPlanId,
        compiled: compileShotWithContext(shot, context), error: null };
    } catch (error) {
      if (!(error instanceof StoreError)) throw error;
      return { shot_plan_id: shotPlanId, compiled: null, error };
    }
  });
}

function bindingContext(db: Database.Database,
  projectId: string): BindingCompilationContext {
  const brief = db.prepare(`SELECT mode_key FROM production_briefs
    WHERE project_id = ? ORDER BY brief_version DESC LIMIT 1`).get(
      projectId) as { mode_key: string } | undefined;
  if (!brief) throw new StoreError(
    'BRIEF_REQUIRED', 'Production brief is required');
  const mode = db.prepare(`SELECT capability_declaration_json, validation_status
    FROM modes WHERE key = ?`).get(brief.mode_key) as {
      capability_declaration_json: string;
      validation_status: string;
    } | undefined;
  if (!mode) throw new StoreError('BRIEF_MODE_NOT_FOUND',
    'Production brief mode does not exist', { mode_key: brief.mode_key });
  if (mode.validation_status === 'blocked') throw new StoreError('MODE_BLOCKED',
    'Blocked modes cannot compile generation bindings', {
      mode_key: brief.mode_key,
    });
  const manifest = db.prepare(`SELECT id FROM current_assets_manifests
    WHERE project_id = ? ORDER BY manifest_version DESC LIMIT 1`).get(
      projectId) as { id: string } | undefined;
  if (!manifest) throw new StoreError(
    'MANIFEST_REQUIRED', 'Manifest is required');
  const manifestAssetIds = (db.prepare(
    'SELECT asset_id FROM manifest_entries WHERE manifest_id = ?',
  ).all(manifest.id) as Array<{ asset_id: string }>).map(
    ({ asset_id }) => asset_id);
  return {
    manifest_asset_ids: manifestAssetIds,
    assets: db.prepare(
      'SELECT * FROM assets WHERE project_id = ?',
    ).all(projectId).map(mapAsset),
    character_references: db.prepare(`SELECT cr.* FROM character_references cr
      JOIN characters c ON c.id = cr.character_id WHERE c.project_id = ?`)
      .all(projectId).map(mapCharacterReference),
    capability: JSON.parse(
      mode.capability_declaration_json) as ModeCapabilityDeclaration,
  };
}

function compileShotWithContext(shot: ShotPlan,
  context: BindingCompilationContext): CompiledBindingsResult {
  const input: CompileBindingsInput = { shot,
    manifest_asset_ids: context.manifest_asset_ids,
    assets: context.assets,
    character_references: context.character_references,
    capability: context.capability };
  try {
    return compileBindings(input);
  } catch (error) {
    if (error instanceof BindingCompilerError) throw new StoreError(error.code,
      error.message, { shot_plan_id: shot.id });
    throw error;
  }
}
