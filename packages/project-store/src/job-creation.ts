import {
  CreateH3JobBatchInputSchema,
  CreateH3JobInputSchema,
  type CreateH3JobBatchInput,
  type CreateH3JobBatchResult,
  type CreateH3JobInput,
  type H3Job,
} from '@h3storyboard/protocol';
import { BindingCompilerError, validateCompiledInputs } from
  '@h3storyboard/h3-provider';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { compileShotBindings } from './binding-operations.js';
import { StoreError } from './errors.js';
import { buildJobLockSnapshot } from './generation-locks.js';
import { createH3BatchRecord, findH3BatchIdByFingerprint,
  getH3JobBatch, h3BatchFingerprint } from
  './h3-batch-operations.js';
import { parseInput } from './input.js';
import { appendJobEvent, getJob } from './job-support.js';
import { mapH3Job } from './row-mappers.js';
import { requireProject, requireShot, validateContinuityJobBindings,
  validateJobBindings } from './store-guards.js';
import { runWriteTransaction } from './transactions.js';

/**
 * `filmStudioRevision` is the h3-film-studio git revision that compiled
 * `input.prompt` (ADR 0003). The API layer performs the compilation; the store
 * only persists provenance.
 */
export function createH3Job(db: Database.Database, shotPlanId: string,
  rawInput: CreateH3JobInput, filmStudioRevision: string | null = null): H3Job {
  const input = parseInput(CreateH3JobInputSchema, rawInput,
    'H3_BINDINGS_INVALID');
  return runWriteTransaction(db, () =>
    createH3JobRecord(db, shotPlanId, input, filmStudioRevision));
}

export function createH3JobBatch(db: Database.Database, projectId: string,
  rawInput: CreateH3JobBatchInput,
  revisionsByShot: ReadonlyMap<string, string> = new Map()):
  CreateH3JobBatchResult {
  const input = parseInput(CreateH3JobBatchInputSchema, rawInput,
    'H3_BINDINGS_INVALID');
  return runWriteTransaction(db, () => {
    requireProject(db, projectId);
    for (const item of input.items) {
      const shot = requireShot(db, item.shot_plan_id);
      if (shot.project_id !== projectId) throw new StoreError(
        'SHOT_PROJECT_MISMATCH',
        'Shot plan does not belong to the requested project', {
          project_id: projectId, shot_id: item.shot_plan_id,
        });
    }
    const fingerprint = h3BatchFingerprint(projectId, input);
    const replayBatchId = findH3BatchIdByFingerprint(
      db, projectId, fingerprint);
    if (replayBatchId) return replayH3JobBatch(
      db, projectId, replayBatchId, input);
    for (const item of input.items) {
      const active = db.prepare(`SELECT id FROM h3_jobs
        WHERE shot_plan_id = ? AND idempotency_key <> ?
          AND status IN ('draft', 'submitting', 'queued', 'running', 'timed_out')
        LIMIT 1`).get(item.shot_plan_id, item.job.idempotency_key) as
        { id: string } | undefined;
      if (active) throw new StoreError('H3_JOB_ACTIVE',
        'Shot already has an active H3 generation task', {
          shot_plan_id: item.shot_plan_id, active_job_id: active.id,
        });
    }
    const items = input.items.map((item) => ({
      shot_plan_id: item.shot_plan_id,
      job: createH3JobRecord(db, item.shot_plan_id, item.job,
        revisionsByShot.get(item.shot_plan_id) ?? null),
    }));
    const batch = createH3BatchRecord(db, projectId, fingerprint, items);
    return { project_id: projectId, batch, items };
  });
}

function replayH3JobBatch(db: Database.Database, projectId: string,
  batchId: string, input: CreateH3JobBatchInput): CreateH3JobBatchResult {
  const items = input.items.map((item) => {
    const row = db.prepare(`SELECT j.* FROM h3_job_batch_items bi
      JOIN h3_jobs j ON j.id = bi.original_job_id
      WHERE bi.batch_id = ? AND bi.shot_plan_id = ?
        AND j.idempotency_key = ?`).get(
      batchId, item.shot_plan_id, item.job.idempotency_key);
    if (!row) throw new StoreError('DATABASE_RECORD_INVALID',
      'Durable H3 batch replay is missing its original job', {
        batch_id: batchId, shot_plan_id: item.shot_plan_id,
      });
    const job = mapH3Job(row);
    if (jobInputFingerprint(job) !== jobInputFingerprint(item.job)) {
      throw new StoreError('IDEMPOTENCY_KEY_REUSED',
        'Idempotency key was already used with different H3 job input', {
          shot_plan_id: item.shot_plan_id,
          idempotency_key: item.job.idempotency_key,
        });
    }
    return { shot_plan_id: item.shot_plan_id, job };
  });
  return { project_id: projectId,
    batch: getH3JobBatch(db, projectId, batchId), items };
}

function createH3JobRecord(db: Database.Database, shotPlanId: string,
  input: CreateH3JobInput, filmStudioRevision: string | null): H3Job {
  const shot = requireShot(db, shotPlanId);
  const previous = db.prepare(`SELECT * FROM h3_jobs
    WHERE shot_plan_id = ? AND idempotency_key = ?`)
    .get(shotPlanId, input.idempotency_key);
  if (previous) {
    const existing = mapH3Job(previous);
    if (jobInputFingerprint(existing) !== jobInputFingerprint(input)) {
      throw new StoreError('IDEMPOTENCY_KEY_REUSED',
        'Idempotency key was already used with different H3 job input', {
          shot_plan_id: shotPlanId, idempotency_key: input.idempotency_key,
        });
    }
    return existing;
  }
  if (shot.planning_status !== 'approved') throw new StoreError(
    'SHOT_PLAN_DRAFT', 'Draft or superseded ShotPlans cannot generate H3 jobs', {
      shot_plan_id: shotPlanId, planning_status: shot.planning_status,
    });
  validateContinuityJobBindings(shot, input.input_bindings);
  validateJobBindings(db, shot.project_id, input.mode, input.input_bindings);
  enforceRepresentativeGate(db, shotPlanId, input.gate_override_reason);
  const lockSnapshot = buildJobLockSnapshot(db, shot.project_id);
  let compiledBindings = null;
  if (input.mode !== 'v2v' && input.mode !== 'rv2v') {
    const compiled = compileShotBindings(db, shotPlanId);
    if (compiled.generation_mode !== input.mode) throw new StoreError(
      'MODE_CAPABILITY_MISMATCH',
      'Job mode differs from compiled generation mode');
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
  db.prepare(`INSERT INTO h3_jobs
    (id, project_id, shot_plan_id, mode, provider, model, prompt,
     duration_seconds, seed, steps, audio_mode, input_bindings_json,
     idempotency_key, attempt, status, provider_job_id, output_asset_id,
     error_code, error_message, created_at, updated_at, completed_at,
     lease_expires_at, heartbeat_at, lock_snapshot_json,
     compiled_bindings_json, gate_override_reason, film_studio_revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'draft', NULL, NULL,
            NULL, NULL, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)`)
    .run(id, shot.project_id, shotPlanId, input.mode, input.provider,
      input.model, input.prompt, input.duration_seconds, input.seed, input.steps,
      input.audio_mode, JSON.stringify(input.input_bindings),
      input.idempotency_key, now, now, JSON.stringify(lockSnapshot),
      compiledBindings === null ? null : JSON.stringify(compiledBindings),
      input.gate_override_reason ?? null, filmStudioRevision);
  appendJobEvent(db, id, null, 'draft', 'Job created', now);
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
    .run(now, shot.project_id);
  return getJob(db, id);
}

/**
 * `prompt` is deliberately not part of the identity: since ADR 0003 the API
 * derives it from the plan's h3_prompt_spec through h3-film-studio, so a
 * replay with the same key and the same request must succeed even though the
 * client's free-text prompt was replaced.
 */
export function jobInputFingerprint(input: CreateH3JobInput | H3Job): string {
  return JSON.stringify({ mode: input.mode, provider: input.provider,
    model: input.model,
    duration_seconds: input.duration_seconds, seed: input.seed,
    steps: input.steps, audio_mode: input.audio_mode ?? 'h3_native',
    input_bindings: input.input_bindings,
    gate_override_reason: input.gate_override_reason ?? null });
}

function enforceRepresentativeGate(db: Database.Database, shotPlanId: string,
  overrideReason: string | null | undefined): void {
  const count = db.prepare(
    'SELECT COUNT(*) AS count FROM h3_jobs WHERE shot_plan_id = ?')
    .get(shotPlanId) as { count: number };
  if (count.count === 0 || overrideReason) return;
  const representative = db.prepare(`SELECT id FROM shot_actuals
    WHERE shot_plan_id = ? AND is_representative = 1
      AND representative_status = 'approved'`).get(shotPlanId);
  if (!representative) throw new StoreError('TAKE_GATE_BLOCKED',
    'Approve a representative take or provide gate_override_reason', {
      shot_plan_id: shotPlanId,
    });
}
