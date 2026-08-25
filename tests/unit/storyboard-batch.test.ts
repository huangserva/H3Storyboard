import { describe, expect, it } from 'vitest';
import type { GenerationPreflight, H3Job, ShotPlan } from
  '@h3storyboard/protocol';
import { selectBatchReadiness } from
  '../../apps/studio/src/lib/storyboard-batch.js';

describe('storyboard batch readiness', () => {
  it('separates ready, blocked, active, and gate-override shots', () => {
    const shots = ['ready', 'blocked', 'active', 'gate'].map((id, index) =>
      ({ id, ordinal: index + 1 }) as ShotPlan);
    const ready = (gate = false): GenerationPreflight => ({ ready: true,
      mode: 't2v', blocking_error: null, input_bindings: [],
      gate_override_required: gate });
    const preflights = new Map<string, GenerationPreflight>([
      ['ready', ready()], ['blocked', { ...ready(), ready: false,
        mode: null, blocking_error: { code: 'MISSING', message: 'missing' } }],
      ['active', ready()], ['gate', ready(true)],
    ]);
    const jobs = [{ shot_plan_id: 'active', status: 'running' }] as H3Job[];

    expect(selectBatchReadiness(shots, preflights, jobs)).toEqual({
      ready: ['ready', 'gate'], blocked: ['blocked'], active: ['active'],
      gate_override: ['gate'], can_submit: false,
    });
  });
});
