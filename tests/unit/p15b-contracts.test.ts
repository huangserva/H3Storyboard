import { describe, expect, it } from 'vitest';
import {
  BindShotReferenceInputSchema,
  CreateH3JobBatchInputSchema,
} from '@h3storyboard/protocol';

const shotId = '11111111-1111-4111-8111-111111111111';
const secondShotId = '22222222-2222-4222-8222-222222222222';
const assetId = '33333333-3333-4333-8333-333333333333';

describe('P1.5B protocol contracts', () => {
  it('rejects duplicate shots and external audio in an H3 batch', () => {
    const duplicate = CreateH3JobBatchInputSchema.safeParse({ items: [
      batchItem(shotId, 'first-key'), batchItem(shotId, 'second-key'),
    ] });
    expect(duplicate.success).toBe(false);

    const audio = CreateH3JobBatchInputSchema.safeParse({ items: [
      { ...batchItem(secondShotId, 'audio-key'), job: {
        ...batchItem(secondShotId, 'audio-key').job,
        input_bindings: [
          { asset_id: assetId, asset_kind: 'image', role: 'first_frame',
            ordinal: 0 },
          { asset_id: '44444444-4444-4444-8444-444444444444',
            asset_kind: 'audio', role: 'audio', ordinal: 1 },
        ],
      } },
    ] });
    expect(audio.success).toBe(false);
  });

  it('accepts semantic and continuity binding command shapes', () => {
    expect(BindShotReferenceInputSchema.parse({ binding_type: 'semantic',
      purpose: 'first_frame', target: { type: 'asset', asset_id: assetId } }))
      .toMatchObject({ binding_type: 'semantic', purpose: 'first_frame' });
    expect(BindShotReferenceInputSchema.parse({ binding_type: 'continuity',
      purpose: 'first_frame', source_shot_plan_id: shotId,
      source_take_id: secondShotId, reference_asset_id: assetId,
      boundary: 'last_frame' }))
      .toMatchObject({ binding_type: 'continuity', boundary: 'last_frame' });
  });
});

function batchItem(id: string, key: string) {
  return { shot_plan_id: id, job: { mode: 'i2v', provider: 'local_comfyui',
    model: 'H3-local', prompt: 'A valid P1.5B batch generation prompt.',
    duration_seconds: 5, seed: 42, steps: 4, audio_mode: 'silent',
    idempotency_key: `p15b-${key}`, input_bindings: [{ asset_id: assetId,
      asset_kind: 'image', role: 'first_frame', ordinal: 0 }] } };
}
