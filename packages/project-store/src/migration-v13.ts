import type { AssetBinding, SemanticReference } from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { StoreError } from './errors.js';

const purposeByRole: Partial<Record<AssetBinding['role'],
  SemanticReference['purpose']>> = {
  first_frame: 'first_frame',
  last_frame: 'last_frame',
  character: 'reference_character',
  product: 'reference_prop',
  scene: 'reference_stage',
  style: 'reference_style',
};

export function backfillSemanticReferences(db: Database.Database): void {
  const shots = db.prepare(`SELECT id, reference_bindings_json,
    semantic_references_json FROM shot_plans`).all() as Array<{
      id: string;
      reference_bindings_json: string;
      semantic_references_json: string | null;
    }>;
  const update = db.prepare(
    'UPDATE shot_plans SET semantic_references_json = ? WHERE id = ?');
  for (const shot of shots) {
    try {
      const current = shot.semantic_references_json
        ? JSON.parse(shot.semantic_references_json) as unknown[] : [];
      if (current.length > 0) continue;
      const bindings = JSON.parse(shot.reference_bindings_json) as AssetBinding[];
      const semantic = bindings.flatMap((binding): SemanticReference[] => {
        const purpose = binding.asset_kind === 'image'
          ? purposeByRole[binding.role] : undefined;
        return purpose ? [{ purpose, target: { type: 'asset',
          asset_id: binding.asset_id } }] : [];
      });
      if (semantic.length > 0) update.run(JSON.stringify(semantic), shot.id);
    } catch (error) {
      throw new StoreError('DATABASE_RECORD_INVALID',
        'Could not backfill legacy shot semantic references', {
          shot_plan_id: shot.id, cause: String(error),
        });
    }
  }
}
