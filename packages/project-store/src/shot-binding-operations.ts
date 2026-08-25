import {
  BindShotReferenceInputSchema,
  type AssetBinding,
  type BindShotReferenceInput,
  type SemanticReference,
  type ShotPlan,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { StoreError } from './errors.js';
import { requireGenerationUnlocked } from './generation-locks.js';
import { parseInput } from './input.js';
import { mapShotPlan } from './row-mappers.js';
import { requireProject, requireShot, validateAssetBindings,
  validateContinuityDependencies } from './store-guards.js';
import { runWriteTransaction } from './transactions.js';

export function bindShotReference(db: Database.Database, projectId: string,
  shotPlanId: string, rawInput: BindShotReferenceInput): ShotPlan {
  const input = parseInput(BindShotReferenceInputSchema, rawInput);
  return runWriteTransaction(db, () => {
    requireProject(db, projectId);
    const shot = requireShot(db, shotPlanId);
    if (shot.project_id !== projectId) throw new StoreError(
      'SHOT_PROJECT_MISMATCH',
      'Shot plan does not belong to the requested project', {
        project_id: projectId, shot_id: shotPlanId,
      });
    requireGenerationUnlocked(db, projectId);
    const production = input.binding_type === 'semantic'
      ? bindSemantic(db, projectId, shot, input)
      : bindContinuity(db, projectId, shot, input);
    validateReferenceCombination(production.semantic_references);
    validateAssetBindings(db, projectId, production.reference_bindings);
    validateContinuityDependencies(db, projectId, production.continuity_mode,
      production.continuity_dependencies);
    const now = new Date().toISOString();
    db.prepare(`UPDATE shot_plans SET continuity_mode = ?,
      continuity_dependencies_json = ?, reference_bindings_json = ?,
      semantic_references_json = ?, updated_at = ? WHERE id = ?`).run(
      production.continuity_mode,
      JSON.stringify(production.continuity_dependencies),
      JSON.stringify(production.reference_bindings),
      JSON.stringify(production.semantic_references), now, shot.id);
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
      .run(now, projectId);
    return mapShotPlan(db.prepare('SELECT * FROM shot_plans WHERE id = ?')
      .get(shot.id));
  });
}

type ProductionFields = Pick<ShotPlan, 'continuity_mode' |
  'continuity_dependencies' | 'reference_bindings' | 'semantic_references'>;

function bindSemantic(db: Database.Database, projectId: string, shot: ShotPlan,
  input: Extract<BindShotReferenceInput, { binding_type: 'semantic' }>
): ProductionFields {
  validateSemanticTarget(db, projectId, input);
  const cleared = clearContinuityForPurpose(shot, input.purpose);
  return { ...cleared,
    semantic_references: replaceReference(cleared.semantic_references, {
      purpose: input.purpose, target: input.target,
    }) };
}

function bindContinuity(db: Database.Database, projectId: string,
  shot: ShotPlan,
  input: Extract<BindShotReferenceInput, { binding_type: 'continuity' }>
): ProductionFields {
  if (input.source_shot_plan_id === shot.id) throw new StoreError(
    'CONTINUITY_DEPENDENCY_INVALID',
    'A shot cannot use its own Take as a continuity source', {
      shot_plan_id: shot.id, source_take_id: input.source_take_id,
    });
  const cleared = clearContinuityForPurpose(shot, input.purpose);
  const dependency = { source_shot_plan_id: input.source_shot_plan_id,
    source_take_id: input.source_take_id,
    reference_asset_id: input.reference_asset_id, boundary: input.boundary };
  const alreadyLinked = cleared.continuity_dependencies.some((current) =>
    current.source_shot_plan_id === dependency.source_shot_plan_id &&
    current.source_take_id === dependency.source_take_id &&
    current.reference_asset_id === dependency.reference_asset_id &&
    current.boundary === dependency.boundary);
  const continuityDependencies = alreadyLinked
    ? cleared.continuity_dependencies : [...cleared.continuity_dependencies, dependency];
  const binding: AssetBinding = { asset_id: input.reference_asset_id,
    asset_kind: 'image', role: input.purpose, ordinal: 0 };
  const referenceBindings = normalizeBindingOrdinals([
    ...cleared.reference_bindings.filter(({ role }) => role !== input.purpose),
    binding,
  ]);
  validateAssetBindings(db, projectId, referenceBindings);
  return { continuity_mode: deriveContinuityMode(
      continuityDependencies, referenceBindings),
    continuity_dependencies: continuityDependencies,
    reference_bindings: referenceBindings,
    semantic_references: replaceReference(cleared.semantic_references, {
      purpose: input.purpose,
      target: { type: 'asset', asset_id: input.reference_asset_id },
    }) };
}

function validateSemanticTarget(db: Database.Database, projectId: string,
  input: Extract<BindShotReferenceInput, { binding_type: 'semantic' }>): void {
  if (input.target.type === 'asset') {
    const asset = db.prepare(
      'SELECT project_id, kind, status FROM assets WHERE id = ?')
      .get(input.target.asset_id) as {
        project_id: string; kind: string; status: string;
      } | undefined;
    if (!asset) throw new StoreError('ASSET_NOT_FOUND',
      'Bound asset does not exist', { asset_id: input.target.asset_id });
    if (asset.project_id !== projectId) throw new StoreError(
      'ASSET_PROJECT_MISMATCH', 'Bound asset belongs to another project', {
        project_id: projectId, asset_id: input.target.asset_id,
      });
    if (asset.kind !== 'image') throw new StoreError('ASSET_KIND_MISMATCH',
      'Storyboard reference targets must be images', {
        asset_id: input.target.asset_id, asset_kind: asset.kind,
      });
    if (asset.status === 'archived') throw new StoreError('ASSET_ARCHIVED',
      'Archived assets cannot be bound', { asset_id: input.target.asset_id });
    return;
  }
  const character = db.prepare(
    'SELECT project_id, status FROM characters WHERE id = ?')
    .get(input.target.character_id) as {
      project_id: string; status: string;
    } | undefined;
  if (!character) throw new StoreError('CHARACTER_NOT_FOUND',
    'Bound character does not exist', {
      character_id: input.target.character_id,
    });
  if (character.project_id !== projectId) throw new StoreError(
    'CHARACTER_REFERENCE_PROJECT_MISMATCH',
    'Bound character belongs to another project', {
      project_id: projectId, character_id: input.target.character_id,
    });
  if (character.status === 'archived') throw new StoreError(
    'CHARACTER_ARCHIVED', 'Archived characters cannot be bound', {
      character_id: input.target.character_id,
    });
}

function clearContinuityForPurpose(shot: ShotPlan,
  purpose: SemanticReference['purpose']): ProductionFields {
  if (purpose !== 'first_frame' && purpose !== 'last_frame' &&
    purpose !== 'reference_target_state') return { continuity_mode: shot.continuity_mode,
    continuity_dependencies: shot.continuity_dependencies,
    reference_bindings: shot.reference_bindings,
    semantic_references: shot.semantic_references };
  const role = purpose === 'reference_target_state' ? 'last_frame' : purpose;
  const bindings = normalizeBindingOrdinals(shot.reference_bindings
    .filter((binding) => binding.role !== role));
  const remainingAssetIds = new Set(bindings.map(({ asset_id }) => asset_id));
  const dependencies = shot.continuity_dependencies.filter(
    ({ reference_asset_id }) => remainingAssetIds.has(reference_asset_id));
  return { continuity_mode: deriveContinuityMode(dependencies, bindings),
    continuity_dependencies: dependencies,
    reference_bindings: bindings,
    semantic_references: shot.semantic_references };
}

function deriveContinuityMode(
  dependencies: ShotPlan['continuity_dependencies'],
  bindings: AssetBinding[],
): ShotPlan['continuity_mode'] {
  if (dependencies.length === 0) return 'independent';
  return dependencies.some((dependency) => dependency.boundary === 'last_frame' &&
    bindings.some(({ asset_id, role }) =>
      asset_id === dependency.reference_asset_id && role === 'first_frame'))
    ? 'chained' : 'visual_match';
}

function replaceReference(references: SemanticReference[],
  next: SemanticReference): SemanticReference[] {
  const singleton = ['first_frame', 'last_frame', 'reference_target_state'];
  const incompatible = next.purpose === 'last_frame' ? 'reference_target_state' :
    next.purpose === 'reference_target_state' ? 'last_frame' : null;
  const filtered = references.filter((reference) =>
    (singleton.includes(next.purpose) ? reference.purpose !== next.purpose :
      !(reference.purpose === next.purpose &&
        JSON.stringify(reference.target) === JSON.stringify(next.target))) &&
    reference.purpose !== incompatible);
  return [...filtered, next];
}

function validateReferenceCombination(references: SemanticReference[]): void {
  const purposes = references.map(({ purpose }) => purpose);
  const hasFirst = purposes.includes('first_frame');
  const hasEnding = purposes.includes('last_frame') ||
    purposes.includes('reference_target_state');
  const hasGeneral = purposes.some((purpose) =>
    purpose.startsWith('reference_') && purpose !== 'reference_target_state');
  if ((hasEnding && !hasFirst) || (hasEnding && hasGeneral)) throw new StoreError(
    'BINDING_INVALID_COMBINATION',
    hasEnding && !hasFirst
      ? 'An ending frame requires a first frame'
      : 'Frame interpolation cannot include additional reference inputs');
}

function normalizeBindingOrdinals(bindings: AssetBinding[]): AssetBinding[] {
  const priority = (binding: AssetBinding) => binding.role === 'first_frame'
    ? -2 : binding.role === 'last_frame' ? -1 : binding.ordinal;
  return [...bindings].sort((left, right) => priority(left) - priority(right))
    .map((binding, ordinal) => ({ ...binding, ordinal }));
}
