import { compileBindings, BindingCompilerError,
  type CompileBindingsInput } from '@h3storyboard/h3-provider';
import type { CompiledBindingsResult } from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { StoreError } from './errors.js';
import { mapAsset, mapCharacterReference, mapShotPlan } from './row-mappers.js';

export function compileShotBindings(db: Database.Database,
  shotPlanId: string): CompiledBindingsResult {
  const shotRow = db.prepare('SELECT * FROM shot_plans WHERE id = ?').get(shotPlanId);
  if (!shotRow) throw new StoreError('SHOT_PLAN_NOT_FOUND', 'Shot plan does not exist',
    { shot_plan_id: shotPlanId });
  const shot = mapShotPlan(shotRow);
  const brief = db.prepare(`SELECT mode_key FROM production_briefs
    WHERE project_id = ? ORDER BY brief_version DESC LIMIT 1`).get(
      shot.project_id) as { mode_key: string } | undefined;
  if (!brief) throw new StoreError('BRIEF_REQUIRED', 'Production brief is required');
  const mode = db.prepare(`SELECT capability_declaration_json, validation_status
    FROM modes WHERE key = ?`).get(brief.mode_key) as {
      capability_declaration_json: string;
      validation_status: string;
    } | undefined;
  if (!mode) throw new StoreError('BRIEF_MODE_NOT_FOUND',
    'Production brief mode does not exist', { mode_key: brief.mode_key });
  // Candidate remains usable until M1B produces provider validation evidence.
  if (mode.validation_status === 'blocked') throw new StoreError('MODE_BLOCKED',
    'Blocked modes cannot compile generation bindings', {
      mode_key: brief.mode_key,
    });
  const manifest = db.prepare(`SELECT id FROM current_assets_manifests
    WHERE project_id = ? ORDER BY manifest_version DESC LIMIT 1`).get(
      shot.project_id) as { id: string } | undefined;
  if (!manifest) throw new StoreError('MANIFEST_REQUIRED', 'Manifest is required');
  const manifestIds = (db.prepare('SELECT asset_id FROM manifest_entries WHERE manifest_id = ?')
    .all(manifest.id) as Array<{ asset_id: string }>).map(({ asset_id }) => asset_id);
  const input: CompileBindingsInput = { shot, manifest_asset_ids: manifestIds,
    assets: db.prepare('SELECT * FROM assets WHERE project_id = ?').all(shot.project_id)
      .map(mapAsset),
    character_references: db.prepare(`SELECT cr.* FROM character_references cr
      JOIN characters c ON c.id = cr.character_id WHERE c.project_id = ?`)
      .all(shot.project_id).map(mapCharacterReference),
    capability: JSON.parse(mode.capability_declaration_json) as
      CompileBindingsInput['capability'] };
  try { return compileBindings(input); }
  catch (error) {
    if (error instanceof BindingCompilerError) throw new StoreError(error.code,
      error.message, { shot_plan_id: shotPlanId });
    throw error;
  }
}
