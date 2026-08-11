import { describe, expect, it } from 'vitest';
import type { Asset, CharacterReference, SemanticReference } from '@h3storyboard/protocol';
import { BindingCompilerError, compileBindings, validateCompiledInputs } from
  '../../packages/h3-provider/src/index.js';

const asset = (id: string, uri = `${id}.png`) => ({ id, uri, status: 'approved',
  kind: 'image' } as Asset);
const capability = (generation_modes: Array<'t2v'|'i2v'|'fl2v'|'r2v'>) => ({
  generation_modes, duration_seconds: { min: 2, max: 15 }, resolution: {
    min_width: 480, max_width: 480, min_height: 864, max_height: 864 },
  lora_profile_requirements: [], provider_requirements: [], extensions: {},
});
const direct = (purpose: SemanticReference['purpose'], asset_id: string): SemanticReference =>
  ({ purpose, target: { type: 'asset', asset_id } });

describe('compileBindings', () => {
  it.each([
    [[], 't2v'],
    [[direct('first_frame', 'a')], 'i2v'],
    [[direct('last_frame', 'b'), direct('first_frame', 'a')], 'fl2v'],
    [[direct('reference_style', 'b'), direct('reference_prop', 'a')], 'r2v'],
  ] as const)('infers deterministic generation mode %#', (references, expected) => {
    const result = compileBindings({ shot: { semantic_references: [...references] },
      manifest_asset_ids: ['a', 'b'], assets: [asset('a'), asset('b')],
      character_references: [], capability: capability(['t2v','i2v','fl2v','r2v']) });
    expect(result.generation_mode).toBe(expected);
    expect(result.bindings.map(({ slot_index }) => slot_index)).toEqual(
      result.bindings.map((_, index) => index));
  });

  it('resolves character references and orders frames before declared references', () => {
    const reference = { character_id: 'character', asset_id: 'character-asset',
      sort_order: 0 } as CharacterReference;
    const result = compileBindings({ shot: { semantic_references: [
      { purpose: 'reference_character', target: { type: 'character',
        character_id: 'character' } }, direct('first_frame', 'frame') ] },
      manifest_asset_ids: ['frame','character-asset'],
      assets: [asset('frame'), asset('character-asset')],
      character_references: [reference], capability: capability(['r2v']) });
    expect(result.bindings.map(({ purpose }) => purpose)).toEqual(
      ['first_frame', 'reference_character']);
  });

  it('rejects missing, unrelated and unsupported capability inputs', () => {
    expect(() => compileBindings({ shot: { semantic_references: [direct('first_frame','x')] },
      manifest_asset_ids: [], assets: [], character_references: [],
      capability: capability(['i2v']) })).toThrowError(expect.objectContaining(
        { code: 'BINDING_MISSING_INPUT' }));
    const compiled = compileBindings({ shot: { semantic_references: [direct('first_frame','a')] },
      manifest_asset_ids: ['a'], assets: [asset('a')], character_references: [],
      capability: capability(['i2v']) });
    expect(() => validateCompiledInputs(compiled, [{ asset_id:'a', asset_kind:'image',
      role:'first_frame', ordinal:0 }, { asset_id:'b', asset_kind:'image',
      role:'style', ordinal:1 }])).toThrowError(expect.objectContaining(
        { code: 'BINDING_UNRELATED_INPUT' }));
    expect(() => compileBindings({ shot: { semantic_references: [] },
      manifest_asset_ids: [], assets: [], character_references: [],
      capability: capability(['i2v']) })).toThrowError(expect.objectContaining(
        { code: 'MODE_CAPABILITY_MISMATCH' }));
    expect(BindingCompilerError).toBeDefined();
  });

  it.each([
    [[direct('last_frame', 'a')], 'last_frame requires first_frame'],
    [[direct('reference_target_state', 'a')],
      'reference_target_state requires first_frame'],
    [[direct('first_frame', 'a'), direct('last_frame', 'b'),
      direct('reference_style', 'c')], 'Frame interpolation cannot include'],
    [[direct('first_frame', 'a'), direct('last_frame', 'b'),
      direct('reference_target_state', 'c')], 'exactly one ending input'],
  ])('rejects ambiguous frame combinations %#', (semantic_references, message) => {
    expect(() => compileBindings({ shot: { semantic_references },
      manifest_asset_ids: ['a', 'b', 'c'],
      assets: [asset('a'), asset('b'), asset('c')], character_references: [],
      capability: capability(['t2v', 'i2v', 'fl2v', 'r2v']) }))
      .toThrowError(expect.objectContaining({ code: 'BINDING_INVALID_COMBINATION',
        message: expect.stringContaining(message) }));
  });

  it('rejects non-image semantic assets during compilation', () => {
    expect(() => compileBindings({ shot: { semantic_references: [
      direct('first_frame', 'video') ] }, manifest_asset_ids: ['video'],
      assets: [{ ...asset('video'), kind: 'video' }], character_references: [],
      capability: capability(['i2v']) })).toThrowError(expect.objectContaining(
        { code: 'BINDING_KIND_MISMATCH' }));
  });

  it('skips archived character references in favor of an approved manifest asset', () => {
    const result = compileBindings({ shot: { semantic_references: [{
      purpose: 'reference_character', target: { type: 'character',
        character_id: 'character' } }] }, manifest_asset_ids: ['old', 'current'],
      assets: [{ ...asset('old'), status: 'archived' }, asset('current')],
      character_references: [
        { character_id: 'character', asset_id: 'old', sort_order: 0 },
        { character_id: 'character', asset_id: 'current', sort_order: 1 },
      ] as CharacterReference[], capability: capability(['r2v']) });
    expect(result.bindings[0]?.asset_id).toBe('current');
  });
});
