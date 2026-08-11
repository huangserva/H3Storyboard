import type {
  Asset, AssetBinding, CharacterReference, CompiledBindingsResult,
  ModeCapabilityDeclaration, SemanticReference, ShotPlan,
} from '@h3storyboard/protocol';

export type BindingCompilerErrorCode =
  | 'BINDING_MISSING_INPUT'
  | 'BINDING_UNRELATED_INPUT'
  | 'BINDING_INVALID_COMBINATION'
  | 'BINDING_KIND_MISMATCH'
  | 'MODE_CAPABILITY_MISMATCH';

export class BindingCompilerError extends Error {
  constructor(readonly code: BindingCompilerErrorCode, message: string) {
    super(message); this.name = 'BindingCompilerError';
  }
}

const purposeRole: Record<SemanticReference['purpose'], AssetBinding['role']> = {
  first_frame: 'first_frame', last_frame: 'last_frame',
  reference_character: 'character', reference_prop: 'product',
  reference_composition: 'scene', reference_style: 'style',
  reference_stage: 'scene', reference_target_state: 'last_frame',
};

export function validateCompiledInputs(compiled: CompiledBindingsResult,
  submitted: readonly AssetBinding[]): void {
  for (const binding of compiled.bindings) {
    if (!submitted.some(({ asset_id, role }) => asset_id === binding.asset_id &&
      role === purposeRole[binding.purpose])) {
      throw new BindingCompilerError('BINDING_MISSING_INPUT',
        `Submitted inputs omit slot ${binding.slot_index}`);
    }
  }
  if (submitted.length !== compiled.bindings.length || submitted.some(
    (binding, index) => compiled.bindings[index]?.asset_id !== binding.asset_id ||
      purposeRole[compiled.bindings[index]!.purpose] !== binding.role ||
      binding.ordinal !== index)) {
    throw new BindingCompilerError('BINDING_UNRELATED_INPUT',
      'Submitted inputs contain assets or ordering outside the compiled list');
  }
}

export interface CompileBindingsInput {
  shot: Pick<ShotPlan, 'semantic_references'>;
  manifest_asset_ids: readonly string[];
  assets: readonly Asset[];
  character_references: readonly CharacterReference[];
  capability: ModeCapabilityDeclaration;
}

const priority = (reference: SemanticReference, index: number) =>
  reference.purpose === 'first_frame' ? -2 :
    reference.purpose === 'last_frame' ? -1 : index;

export function compileBindings(input: CompileBindingsInput): CompiledBindingsResult {
  const manifest = new Set(input.manifest_asset_ids);
  const assets = new Map(input.assets.map((asset) => [asset.id, asset]));
  validateReferenceCombination(input.shot.semantic_references);
  const ordered = input.shot.semantic_references.map((reference, index) =>
    ({ reference, index })).sort((a, b) =>
      priority(a.reference, a.index) - priority(b.reference, b.index));
  const bindings = ordered.map(({ reference }, slotIndex) => {
    const assetId = resolveAsset(reference, input.character_references,
      manifest, assets);
    const asset = assetId ? assets.get(assetId) : undefined;
    if (!asset || asset.status !== 'approved' || !manifest.has(asset.id)) {
      throw new BindingCompilerError('BINDING_MISSING_INPUT',
        `No approved manifest asset resolves ${reference.purpose}`);
    }
    if (asset.kind !== 'image') throw new BindingCompilerError(
      'BINDING_KIND_MISMATCH',
      `${reference.purpose} requires an image asset, received ${asset.kind}`);
    return { slot_index: slotIndex, purpose: reference.purpose,
      asset_id: asset.id, uri: asset.uri };
  });
  const purposes = new Set(bindings.map(({ purpose }) => purpose));
  const hasMultiReference = [...purposes].some((purpose) =>
    purpose.startsWith('reference_') && purpose !== 'reference_target_state');
  const generationMode = purposes.has('reference_target_state') ||
    (purposes.has('first_frame') && purposes.has('last_frame')) ? 'fl2v' :
    hasMultiReference ? 'r2v' : purposes.has('first_frame') ? 'i2v' : 't2v';
  if (!input.capability.generation_modes.includes(generationMode)) {
    throw new BindingCompilerError('MODE_CAPABILITY_MISMATCH',
      `Mode capability does not allow ${generationMode}`);
  }
  return { generation_mode: generationMode, bindings };
}

function validateReferenceCombination(references: readonly SemanticReference[]): void {
  const purposes = references.map(({ purpose }) => purpose);
  const count = (purpose: SemanticReference['purpose']) =>
    purposes.filter((value) => value === purpose).length;
  if (count('first_frame') > 1 || count('last_frame') > 1 ||
    count('reference_target_state') > 1) {
    throw new BindingCompilerError('BINDING_INVALID_COMBINATION',
      'Frame interpolation accepts one first_frame and exactly one ending input');
  }
  const hasFirst = purposes.includes('first_frame');
  const hasLast = purposes.includes('last_frame');
  const hasTarget = purposes.includes('reference_target_state');
  if ((hasLast || hasTarget) && !hasFirst) {
    const ending = hasLast ? 'last_frame' : 'reference_target_state';
    throw new BindingCompilerError('BINDING_INVALID_COMBINATION',
      `${ending} requires first_frame`);
  }
  if (hasLast && hasTarget) throw new BindingCompilerError(
    'BINDING_INVALID_COMBINATION',
    'Frame interpolation requires exactly one ending input: last_frame or reference_target_state');
  const hasGeneralReference = purposes.some((purpose) =>
    purpose.startsWith('reference_') && purpose !== 'reference_target_state');
  if ((hasLast || hasTarget) && hasGeneralReference) throw new BindingCompilerError(
    'BINDING_INVALID_COMBINATION',
    'Frame interpolation cannot include additional reference inputs');
}

function resolveAsset(reference: SemanticReference,
  characterReferences: readonly CharacterReference[], manifest: Set<string>,
  assets: ReadonlyMap<string, Asset>) {
  if (reference.target.type === 'asset') return reference.target.asset_id;
  const characterId = reference.target.character_id;
  return characterReferences.filter(({ character_id, asset_id }) =>
    character_id === characterId && asset_id !== null &&
    manifest.has(asset_id) && assets.get(asset_id)?.status === 'approved')
    .sort((a, b) => a.sort_order - b.sort_order)[0]?.asset_id;
}
