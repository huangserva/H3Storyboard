import { describe, expect, it } from 'vitest';
import {
  H3JobBatchSchema,
  RetryH3JobInputSchema,
} from '@h3storyboard/protocol';

describe('M3 batch orchestration contracts', () => {
  it('requires a durable idempotency key for explicit shot retries', () => {
    expect(RetryH3JobInputSchema.safeParse({ idempotency_key: 'short' }).success)
      .toBe(false);
    expect(RetryH3JobInputSchema.parse({
      idempotency_key: 'm3-retry-00000001',
    })).toEqual({ idempotency_key: 'm3-retry-00000001' });
  });

  it('rejects progress counts that do not classify every item', () => {
    const parsed = H3JobBatchSchema.safeParse({
      id: crypto.randomUUID(),
      project_id: crypto.randomUUID(),
      status: 'running',
      progress: {
        total: 2,
        pending: 1,
        active: 1,
        recovering: 0,
        completed: 1,
        attention: 0,
        progress_percent: 50,
      },
      items: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a batch status that contradicts otherwise valid counts', () => {
    const now = new Date().toISOString();
    const jobId = crypto.randomUUID();
    const currentJob = { id: jobId, project_id: crypto.randomUUID(),
      shot_plan_id: crypto.randomUUID(), retry_of_job_id: null, mode: 't2v',
      provider: 'local_comfyui', model: 'H3-local',
      prompt: 'A valid pending H3 batch contract fixture.',
      duration_seconds: 5, seed: 42, steps: 4, audio_mode: 'silent',
      idempotency_key: 'm3-status-contract-0001', input_bindings: [],
      status: 'draft', attempt: 0, provider_job_id: null,
      provider_client_id: null, output_asset_id: null, error_code: null,
      error_message: null, lease_token: null, lease_expires_at: null,
      heartbeat_at: null, created_at: now, updated_at: now,
      completed_at: null, lock_snapshot: null, compiled_bindings: null,
      gate_override_reason: null, cancel_reason: null };
    const item = { shot_plan_id: crypto.randomUUID(), ordinal: 0,
      original_job_id: jobId, retry_count: 0, retryable: false,
      current_job: currentJob };
    const parsed = H3JobBatchSchema.safeParse({
      id: crypto.randomUUID(), project_id: crypto.randomUUID(),
      status: 'running',
      progress: { total: 1, pending: 1, active: 0, recovering: 0,
        completed: 0, attention: 0, progress_percent: 0 },
      items: [item],
      created_at: now, updated_at: now,
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error('Expected contradictory status error');
    expect(parsed.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['status'] }),
    ]));

    const mismatchedItem = H3JobBatchSchema.safeParse({
      id: crypto.randomUUID(), project_id: crypto.randomUUID(),
      status: 'pending',
      progress: { total: 1, pending: 1, active: 0, recovering: 0,
        completed: 0, attention: 0, progress_percent: 0 },
      items: [{ ...item, current_job: { ...currentJob, status: 'completed' } }],
      created_at: now, updated_at: now,
    });
    expect(mismatchedItem.success).toBe(false);
    if (mismatchedItem.success) throw new Error('Expected item progress error');
    expect(mismatchedItem.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['progress'] }),
    ]));
  });
});
