import {
  RetryH3JobInputSchema,
  type RetryH3JobInput,
  type RetryH3JobResult,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { StoreError } from './errors.js';
import {
  findH3JobBatchByCurrentJob,
  findH3JobBatchByLineage,
  getH3JobBatch,
} from './h3-batch-operations.js';
import { parseInput } from './input.js';
import { jobInputFingerprint } from './job-creation.js';
import { appendJobEvent, getJob } from './job-support.js';
import { runWriteTransaction } from './transactions.js';

export function retryH3Job(db: Database.Database, projectId: string,
  jobId: string, rawInput: RetryH3JobInput): RetryH3JobResult {
  const input = parseInput(RetryH3JobInputSchema, rawInput,
    'H3_RETRY_INPUT_INVALID');
  return runWriteTransaction(db, () => {
    const original = getJob(db, jobId);
    if (original.project_id !== projectId) throw new StoreError(
      'H3_JOB_NOT_FOUND', 'H3 job does not exist',
      { project_id: projectId, job_id: jobId });
    const previous = db.prepare(`SELECT id FROM h3_jobs
      WHERE shot_plan_id = ? AND idempotency_key = ?`)
      .get(original.shot_plan_id, input.idempotency_key) as
      { id: string } | undefined;
    if (previous) {
      const existing = getJob(db, previous.id);
      if (existing.retry_of_job_id !== original.id ||
        jobInputFingerprint(existing) !== jobInputFingerprint(original)) {
        throw new StoreError('IDEMPOTENCY_KEY_REUSED',
          'Idempotency key was already used for another H3 job', {
            shot_plan_id: original.shot_plan_id,
            idempotency_key: input.idempotency_key,
          });
      }
      return retryResult(db, projectId, existing);
    }
    const successor = db.prepare(`SELECT id FROM h3_jobs
      WHERE retry_of_job_id = ? LIMIT 1`).get(original.id) as
      { id: string } | undefined;
    if (successor) throw new StoreError('H3_JOB_RETRY_INVALID',
      'H3 job already has an immutable retry',
      { job_id: original.id, retry_job_id: successor.id });
    if (!['failed', 'canceled', 'timed_out'].includes(original.status)) {
      throw new StoreError('H3_JOB_RETRY_INVALID',
        'Only failed, canceled, or timed-out H3 jobs can be retried',
        { job_id: original.id, status: original.status });
    }
    const active = db.prepare(`WITH RECURSIVE ancestors(id) AS (
        SELECT ? UNION ALL
        SELECT h.retry_of_job_id FROM h3_jobs h JOIN ancestors a ON h.id = a.id
        WHERE h.retry_of_job_id IS NOT NULL
      ) SELECT id FROM h3_jobs
      WHERE shot_plan_id = ? AND id NOT IN (SELECT id FROM ancestors)
        AND status IN ('draft', 'submitting', 'queued', 'running', 'timed_out')
      LIMIT 1`).get(original.id, original.shot_plan_id) as
      { id: string } | undefined;
    if (active) throw new StoreError('H3_JOB_ACTIVE',
      'Shot already has an active H3 generation task', {
        shot_plan_id: original.shot_plan_id, active_job_id: active.id });

    const id = randomUUID();
    const now = new Date().toISOString();
    const recoverProviderTask = original.status === 'timed_out' &&
      (original.provider_job_id !== null || original.provider_client_id !== null);
    const retryStatus = recoverProviderTask ? 'timed_out' : 'draft';
    db.prepare(`INSERT INTO h3_jobs
      (id, project_id, shot_plan_id, retry_of_job_id, mode, provider, model,
       prompt, duration_seconds, seed, steps, audio_mode, input_bindings_json,
       idempotency_key, attempt, status, provider_job_id, provider_client_id,
       output_asset_id, error_code, error_message, lease_token,
       lease_expires_at, heartbeat_at, created_at, updated_at, completed_at,
       lock_snapshot_json, compiled_bindings_json, gate_override_reason,
       cancel_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, ?,
              ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL)`)
      .run(id, projectId, original.shot_plan_id, original.id, original.mode,
        original.provider, original.model, original.prompt,
        original.duration_seconds, original.seed, original.steps,
        original.audio_mode, JSON.stringify(original.input_bindings),
        input.idempotency_key, retryStatus,
        recoverProviderTask ? original.provider_job_id : null,
        recoverProviderTask ? original.provider_client_id : null,
        recoverProviderTask ? 'H3_RETRY_PROVIDER_RECOVERY' : null,
        recoverProviderTask
          ? 'Retry preserves the existing provider task to prevent resubmission'
          : null,
        now, now, recoverProviderTask ? now : null,
        original.lock_snapshot === null ? null :
          JSON.stringify(original.lock_snapshot),
        original.compiled_bindings === null ? null :
          JSON.stringify(original.compiled_bindings),
        original.gate_override_reason);
    appendJobEvent(db, id, null, retryStatus,
      `Immutable retry created for ${original.id}`, now);
    const batch = findH3JobBatchByCurrentJob(db, original.id);
    if (batch) {
      const changed = db.prepare(`UPDATE h3_job_batch_items
        SET current_job_id = ? WHERE batch_id = ? AND current_job_id = ?`)
        .run(id, batch.batch_id, original.id);
      if (changed.changes !== 1) throw new StoreError(
        'H3_JOB_RETRY_INVALID',
        'Batch current job changed before retry could be recorded',
        { job_id: original.id, batch_id: batch.batch_id });
      db.prepare('UPDATE h3_job_batches SET updated_at = ? WHERE id = ?')
        .run(now, batch.batch_id);
    }
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
      .run(now, projectId);
    return retryResult(db, projectId, getJob(db, id));
  });
}

function retryResult(db: Database.Database, projectId: string,
  job: ReturnType<typeof getJob>): RetryH3JobResult {
  const membership = findH3JobBatchByLineage(db, job.id);
  return { project_id: projectId, job,
    batch: membership ? getH3JobBatch(db, projectId, membership.batch_id) :
      null };
}
