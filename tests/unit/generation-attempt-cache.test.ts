import { describe, expect, it } from 'vitest';
import type { GenerationPreflight, ShotPlan } from '@h3storyboard/protocol';
import { H3BatchAttemptCache } from
  '../../apps/studio/src/lib/generation-attempt-cache.js';

describe('H3 batch UI retry identity', () => {
  it('reuses exact idempotency keys after a lost response and rotates after success', () => {
    const cache = new H3BatchAttemptCache();
    const shots = [{ id: crypto.randomUUID(), prompt: 'shot one',
      duration_seconds: 5, ordinal: 1 }] as ShotPlan[];
    const preflight = { ready: true, mode: 'i2v', blocking_error: null,
      gate_override_required: false, input_bindings: [{ asset_id: crypto.randomUUID(),
        asset_kind: 'image', role: 'first_frame', ordinal: 0 }] } as
      GenerationPreflight;
    const preflights = new Map([[shots[0]!.id, preflight]]);

    const first = cache.prepare(shots, preflights, null);
    const retry = cache.prepare(shots, preflights, null);
    expect(retry.input).toEqual(first.input);
    cache.complete(first.key);
    const nextTake = cache.prepare(shots, preflights, null);
    expect(nextTake.input.items[0]!.job.idempotency_key)
      .not.toBe(first.input.items[0]!.job.idempotency_key);
  });
});
