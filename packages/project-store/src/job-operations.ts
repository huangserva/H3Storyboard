import {
  CreateH3JobInputSchema,
  type CreateH3JobInput,
  type H3Job,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { StoreError } from './errors.js';
import { buildJobLockSnapshot } from './generation-locks.js';
import { compileShotBindings } from './binding-operations.js';
import { BindingCompilerError, validateCompiledInputs } from '@h3storyboard/h3-provider';
import { parseInput } from './input.js';
import {
  appendJobEvent,
  getJob,
  requireJobTransition,
  requireLeaseToken,
} from './job-support.js';
import { mapH3Job } from './row-mappers.js';
import { requireShot, validateContinuityJobBindings, validateJobBindings } from './store-guards.js';
import { runWriteTransaction } from './transactions.js';

export function createH3Job(
  db: Database.Database,
  shotPlanId: string,
  rawInput: CreateH3JobInput,
): H3Job {
  const input = parseInput(
    CreateH3JobInputSchema,
    rawInput,
    'H3_BINDINGS_INVALID',
  );
  return runWriteTransaction(db, () => {
    const shot = requireShot(db, shotPlanId);
    validateContinuityJobBindings(shot, input.input_bindings);
    validateJobBindings(db, shot.project_id, input.mode, input.input_bindings);
    const previous = db
      .prepare(
        `SELECT * FROM h3_jobs
         WHERE shot_plan_id = ? AND idempotency_key = ?`,
      )
      .get(shotPlanId, input.idempotency_key);
    if (previous) {
      const existing = mapH3Job(previous);
      if (jobInputFingerprint(existing) !== jobInputFingerprint(input)) {
        throw new StoreError(
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency key was already used with different H3 job input',
          { shot_plan_id: shotPlanId, idempotency_key: input.idempotency_key },
        );
      }
      return existing;
    }
    enforceRepresentativeGate(db, shotPlanId, input.gate_override_reason);
    const lockSnapshot = buildJobLockSnapshot(db, shot.project_id);
    let compiledBindings = null;
    if (input.mode !== 'v2v' && input.mode !== 'rv2v') {
      const compiled = compileShotBindings(db, shotPlanId);
      if (compiled.generation_mode !== input.mode) throw new StoreError(
        'MODE_CAPABILITY_MISMATCH', 'Job mode differs from compiled generation mode');
      try { validateCompiledInputs(compiled, input.input_bindings); }
      catch (error) {
        if (error instanceof BindingCompilerError) throw new StoreError(
          error.code, error.message, { shot_plan_id: shotPlanId });
        throw error;
      }
      compiledBindings = compiled.bindings;
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO h3_jobs
       (id, project_id, shot_plan_id, mode, provider, model, prompt,
        duration_seconds, seed, steps, audio_mode, input_bindings_json, idempotency_key,
        attempt, status, provider_job_id, output_asset_id, error_code,
        error_message, created_at, updated_at, completed_at, lease_expires_at,
        heartbeat_at, lock_snapshot_json, compiled_bindings_json,
        gate_override_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'draft', NULL, NULL,
               NULL, NULL, ?, ?, NULL, NULL, NULL, ?, ?, ?)`,
    ).run(
      id,
      shot.project_id,
      shotPlanId,
      input.mode,
      input.provider,
      input.model,
      input.prompt,
      input.duration_seconds,
      input.seed,
      input.steps,
      input.audio_mode,
      JSON.stringify(input.input_bindings),
      input.idempotency_key,
      now,
      now,
      JSON.stringify(lockSnapshot),
      compiledBindings === null ? null : JSON.stringify(compiledBindings),
      input.gate_override_reason ?? null,
    );
    appendJobEvent(db, id, null, 'draft', 'Job created', now);
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(
      now,
      shot.project_id,
    );
    return getJob(db, id);
  });
}

function jobInputFingerprint(input: CreateH3JobInput | H3Job): string {
  return JSON.stringify({
    mode: input.mode,
    provider: input.provider,
    model: input.model,
    prompt: input.prompt,
    duration_seconds: input.duration_seconds,
    seed: input.seed,
    steps: input.steps,
    audio_mode: input.audio_mode ?? 'h3_native',
    input_bindings: input.input_bindings,
    gate_override_reason: input.gate_override_reason ?? null,
  });
}

function enforceRepresentativeGate(db: Database.Database, shotPlanId: string,
  overrideReason: string | null | undefined): void {
  const count = db.prepare('SELECT COUNT(*) AS count FROM h3_jobs WHERE shot_plan_id = ?')
    .get(shotPlanId) as { count: number };
  if (count.count === 0 || overrideReason) return;
  const representative = db.prepare(`SELECT id FROM shot_actuals
    WHERE shot_plan_id = ? AND is_representative = 1
      AND representative_status = 'approved'`).get(shotPlanId);
  if (!representative) throw new StoreError('TAKE_GATE_BLOCKED',
    'Approve a representative take or provide gate_override_reason',
    { shot_plan_id: shotPlanId });
}

export function markH3JobQueued(
  db: Database.Database,
  jobId: string,
  leaseToken: string,
  providerJobId: string,
): H3Job {
  return runWriteTransaction(db, () => {
    const job = getJob(db, jobId);
    requireJobTransition(job, 'queued');
    requireLeaseToken(job, leaseToken);
    const now = new Date().toISOString();
    const result = db.prepare(
      `UPDATE h3_jobs SET status = 'queued', provider_job_id = ?,
       heartbeat_at = ?, updated_at = ?
       WHERE id = ? AND status = 'submitting' AND lease_token = ?`,
    ).run(providerJobId, now, now, jobId, leaseToken);
    if (result.changes !== 1) {
      throw new StoreError(
        'H3_JOB_STATUS_INVALID',
        'H3 job changed before it could be queued',
        { job_id: jobId },
      );
    }
    appendJobEvent(
      db,
      jobId,
      'submitting',
      'queued',
      'Provider accepted job',
      now,
    );
    return getJob(db, jobId);
  });
}

export function markH3SubmitIntent(db: Database.Database, jobId: string,
  leaseToken: string, providerClientId: string): H3Job {
  if (!providerClientId.trim()) throw new StoreError('INPUT_INVALID',
    'Provider client id must not be empty');
  return runWriteTransaction(db, () => {
    const job = getJob(db, jobId);
    requireLeaseToken(job, leaseToken);
    if (job.status !== 'submitting') throw new StoreError(
      'H3_JOB_STATUS_INVALID', 'Submit intent requires a submitting job');
    const now = new Date().toISOString();
    const result = db.prepare(`UPDATE h3_jobs SET provider_client_id = ?,
      heartbeat_at = ?, updated_at = ? WHERE id = ? AND status = 'submitting'
      AND lease_token = ?`).run(providerClientId, now, now, jobId, leaseToken);
    if (result.changes !== 1) throw new StoreError('H3_JOB_LEASE_INVALID',
      'Submit intent lost its worker lease');
    return getJob(db, jobId);
  });
}

export function clearH3ProviderTask(db: Database.Database, jobId: string,
  leaseToken: string): H3Job {
  return runWriteTransaction(db, () => {
    const job = getJob(db, jobId);
    requireLeaseToken(job, leaseToken);
    if (job.status !== 'submitting') throw new StoreError(
      'H3_JOB_STATUS_INVALID', 'Provider task reset requires a submitting job');
    db.prepare(`UPDATE h3_jobs SET provider_job_id = NULL,
      provider_client_id = NULL, updated_at = ? WHERE id = ? AND lease_token = ?`)
      .run(new Date().toISOString(), jobId, leaseToken);
    return getJob(db, jobId);
  });
}

export function markH3JobRunning(
  db: Database.Database,
  jobId: string,
  leaseToken: string,
): H3Job {
  return runWriteTransaction(db, () => {
    const job = getJob(db, jobId);
    requireJobTransition(job, 'running');
    requireLeaseToken(job, leaseToken);
    const now = new Date().toISOString();
    const result = db.prepare(
      `UPDATE h3_jobs SET status = 'running', heartbeat_at = ?, updated_at = ?
       WHERE id = ? AND status = 'queued' AND lease_token = ?`,
    ).run(now, now, jobId, leaseToken);
    if (result.changes !== 1) {
      throw new StoreError(
        'H3_JOB_STATUS_INVALID',
        'H3 job changed before it could start',
        { job_id: jobId },
      );
    }
    appendJobEvent(db, jobId, 'queued', 'running', 'Provider started job', now);
    return getJob(db, jobId);
  });
}
