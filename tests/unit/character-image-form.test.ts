import {
  CreateCharacterImageJobInputSchema,
  type CharacterImageOperation,
} from '@h3storyboard/protocol';
import { describe, expect, test } from 'vitest';
import {
  buildCharacterImageJobInput,
  characterImageDefaults,
} from '../../apps/studio/src/lib/character-image-form.js';
import { isCharacterImageJobActive, shouldPollCharacterImageJob } from
  '../../apps/studio/src/lib/use-character-image-jobs.js';

describe('Studio character image form contract', () => {
  const rootReferenceId = 'aeb73251-369b-4d35-91d4-9e29fcc843d6';
  test.each([
    ['master_t2i', [], null, 'krea2'],
    ['identity_edit', [rootReferenceId], 1, 'qwen_image_edit_2511'],
    ['variant_i2i', [rootReferenceId], 0.52, 'krea2'],
  ] as const)('builds a valid %s request with no implicit LoRA',
    (operation, source_reference_ids, denoise, engine) => {
      const defaults = characterImageDefaults(operation);
      const input = buildCharacterImageJobInput({ operation,
        prompt: 'Stable adult character portrait.', seed: 20260824,
        width: 480, height: 864, steps: defaults.steps, cfg: defaults.cfg,
        sampler: defaults.sampler, scheduler: defaults.scheduler, denoise,
        source_reference_ids: [...source_reference_ids] }, 'studio-image-fixed-key');

      expect(CreateCharacterImageJobInputSchema.parse(input)).toMatchObject({
        operation, engine, denoise, source_reference_ids,
        lora_profile: null, lora_name: null, lora_strength: null,
      });
    });

  test('polls only non-terminal statuses', () => {
    for (const status of ['draft', 'submitting', 'queued', 'running'] as const) {
      expect(isCharacterImageJobActive(status)).toBe(true);
    }
    for (const status of ['completed', 'failed', 'canceled', 'timed_out'] as const) {
      expect(isCharacterImageJobActive(status)).toBe(false);
    }
    expect(shouldPollCharacterImageJob({ status: 'timed_out', attempt: 7 } as
      Parameters<typeof shouldPollCharacterImageJob>[0])).toBe(true);
    expect(shouldPollCharacterImageJob({ status: 'timed_out', attempt: 8 } as
      Parameters<typeof shouldPollCharacterImageJob>[0])).toBe(false);
  });

  test('operation defaults stay bound to the audited provider recipes', () => {
    const operations: CharacterImageOperation[] = [
      'master_t2i', 'identity_edit', 'variant_i2i',
    ];
    expect(operations.map((operation) => characterImageDefaults(operation)))
      .toEqual([
        { engine: 'krea2', steps: 8, cfg: 1, sampler: 'euler_ancestral',
          scheduler: 'sgm_uniform', denoise: null },
        { engine: 'qwen_image_edit_2511', steps: 4, cfg: 1, sampler: 'euler',
          scheduler: 'simple', denoise: 1 },
        { engine: 'krea2', steps: 8, cfg: 1, sampler: 'euler_ancestral',
          scheduler: 'sgm_uniform', denoise: 0.52 },
      ]);
  });
});
