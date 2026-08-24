import { describe, expect, it } from 'vitest';
import { CreateCharacterImageJobInputSchema } from '@h3storyboard/protocol';

const referenceId = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`;

const base = {
  provider: 'local_comfyui' as const,
  prompt: 'Cinematic portrait with stable facial identity.',
  seed: 2026082401,
  width: 480,
  height: 864,
  steps: 8,
  cfg: 1,
  sampler: 'euler_ancestral',
  scheduler: 'sgm_uniform',
  idempotency_key: 'character-image-attempt-001',
};

describe('CharacterImageJob protocol', () => {
  it.each([
    ['master_t2i', 'krea2', []],
    ['identity_edit', 'qwen_image_edit_2511', [referenceId(1)]],
    ['variant_i2i', 'krea2', [referenceId(1)]],
  ] as const)('accepts the %s operation contract',
    (operation, engine, sourceReferenceIds) => {
      expect(CreateCharacterImageJobInputSchema.safeParse({
        ...base,
        operation,
        engine,
        source_reference_ids: [...sourceReferenceIds],
        denoise: operation === 'master_t2i' ? null
          : operation === 'variant_i2i' ? 0.42 : 1,
      }).success).toBe(true);
    });

  it('rejects an engine/operation mismatch and missing edit sources', () => {
    const wrongEngine = CreateCharacterImageJobInputSchema.safeParse({
      ...base,
      operation: 'identity_edit',
      engine: 'krea2',
      source_reference_ids: [referenceId(1)],
    });
    const missingSource = CreateCharacterImageJobInputSchema.safeParse({
      ...base,
      operation: 'variant_i2i',
      engine: 'krea2',
      source_reference_ids: [],
      denoise: 0.42,
    });
    expect(wrongEngine.success).toBe(false);
    expect(missingSource.success).toBe(false);
  });

  it('rejects duplicate source references, partial LoRA settings, and invalid sizes', () => {
    const duplicateSources = CreateCharacterImageJobInputSchema.safeParse({
      ...base,
      operation: 'identity_edit',
      engine: 'qwen_image_edit_2511',
      source_reference_ids: [referenceId(1), referenceId(1)],
    });
    const partialLora = CreateCharacterImageJobInputSchema.safeParse({
      ...base,
      operation: 'master_t2i',
      engine: 'krea2',
      source_reference_ids: [],
      lora_strength: 0.75,
    });
    const invalidSize = CreateCharacterImageJobInputSchema.safeParse({
      ...base,
      operation: 'master_t2i',
      engine: 'krea2',
      source_reference_ids: [],
      width: 481,
    });
    expect(duplicateSources.success).toBe(false);
    expect(partialLora.success).toBe(false);
    expect(invalidSize.success).toBe(false);
  });
});
