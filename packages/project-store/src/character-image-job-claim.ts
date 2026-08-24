import { CHARACTER_IMAGE_MAX_AUTO_ATTEMPTS,
  type CharacterImageJob } from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { StoreError } from './errors.js';
import { requireGenerationUnlocked } from './generation-locks.js';
import { runWriteTransaction } from './transactions.js';
import {
  appendCharacterImageJobEvent,
  getCharacterImageJob,
  requireCharacterImageLeaseDuration,
  requireCharacterImageLeaseToken,
  requireCharacterImageTransition,
} from './character-image-job-support.js';

export function claimCharacterImageJob(
  db: Database.Database,
  jobId: string,
  leaseDurationMs = 60_000,
): CharacterImageJob {
  requireCharacterImageLeaseDuration(leaseDurationMs);
  return runWriteTransaction(
    db,
    () => claimJob(db, jobId, leaseDurationMs),
  );
}

export function claimCharacterImageJobForCancellation(
  db: Database.Database,
  jobId: string,
  leaseDurationMs = 60_000,
): CharacterImageJob {
  requireCharacterImageLeaseDuration(leaseDurationMs);
  return runWriteTransaction(db, () => {
    const job = getCharacterImageJob(db, jobId);
    if (job.status !== 'timed_out') throw new StoreError(
      'CHARACTER_IMAGE_JOB_STATUS_INVALID',
      'Only a timed-out image job needs a cancellation lease',
      { job_id: jobId, status: job.status },
    );
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(
      nowDate.getTime() + leaseDurationMs,
    ).toISOString();
    const result = db.prepare(`UPDATE character_image_jobs
      SET status = 'submitting', lease_token = ?, lease_expires_at = ?,
          heartbeat_at = ?, updated_at = ?
      WHERE id = ? AND status = 'timed_out' AND (
        lease_expires_at IS NULL OR lease_expires_at <= ?
      )`).run(leaseToken, leaseExpiresAt, now, now, jobId, now);
    if (result.changes !== 1) throw new StoreError(
      'CHARACTER_IMAGE_JOB_STATUS_INVALID',
      'Timed-out image job changed before cancellation acquired its lease',
      { job_id: jobId },
    );
    appendCharacterImageJobEvent(db, jobId, 'timed_out', 'submitting',
      'Cancellation lease acquired', now);
    return getCharacterImageJob(db, jobId);
  });
}

export function claimNextCharacterImageJob(
  db: Database.Database,
  leaseDurationMs = 60_000,
): CharacterImageJob | null {
  requireCharacterImageLeaseDuration(leaseDurationMs);
  return runWriteTransaction(db, () => {
    const rows = db.prepare(`SELECT id, status, attempt, updated_at
      FROM character_image_jobs
      WHERE provider = 'local_comfyui' AND (
        status = 'draft' OR (status = 'timed_out' AND NOT EXISTS (
          SELECT 1 FROM character_image_jobs retry
          WHERE retry.retry_of_job_id = character_image_jobs.id
        ) AND attempt < ?)
      )
      ORDER BY created_at, id`).all(CHARACTER_IMAGE_MAX_AUTO_ATTEMPTS) as
      Array<{ id: string; status: string; attempt: number; updated_at: string }>;
    const now = Date.now();
    const row = rows.find((candidate) => candidate.status === 'draft' ||
      now - Date.parse(candidate.updated_at) >= retryBackoffMs(candidate.attempt));
    return row ? claimJob(db, row.id, leaseDurationMs) : null;
  });
}

function retryBackoffMs(attempt: number): number {
  return Math.min(60_000, 2_000 * 2 ** Math.max(0, attempt - 1));
}

function claimJob(db: Database.Database, jobId: string,
  leaseDurationMs: number): CharacterImageJob {
  const job = getCharacterImageJob(db, jobId);
  requireGenerationUnlocked(db, job.project_id);
  if (job.status === 'timed_out' && db.prepare(
    'SELECT 1 FROM character_image_jobs WHERE retry_of_job_id = ? LIMIT 1',
  ).get(jobId)) throw new StoreError(
    'CHARACTER_IMAGE_RETRY_INVALID',
    'Timed-out character image job already has an immutable retry',
    { job_id: jobId },
  );
  requireCharacterImageTransition(job, 'submitting');
  const nowDate = new Date();
  if (job.lease_expires_at !== null &&
    Date.parse(job.lease_expires_at) > nowDate.getTime()) throw new StoreError(
    'CHARACTER_IMAGE_JOB_STATUS_INVALID',
    'Character image job already has an active lease',
    { job_id: jobId, lease_expires_at: job.lease_expires_at },
  );
  const now = nowDate.toISOString();
  const leaseExpiresAt = new Date(
    nowDate.getTime() + leaseDurationMs,
  ).toISOString();
  const leaseToken = randomUUID();
  const preserveProvider = job.status === 'timed_out';
  const result = db.prepare(`UPDATE character_image_jobs
    SET status = 'submitting', attempt = attempt + 1, lease_token = ?,
        lease_expires_at = ?, heartbeat_at = ?, updated_at = ?,
        provider_client_id = ?, provider_job_id = ?, output_asset_id = NULL,
        output_reference_id = NULL, error_code = NULL, error_message = NULL,
        cancel_reason = NULL, completed_at = NULL
    WHERE id = ? AND status = ?`)
    .run(leaseToken, leaseExpiresAt, now, now,
      preserveProvider ? job.provider_client_id : null,
      preserveProvider ? job.provider_job_id : null,
      jobId, job.status);
  if (result.changes !== 1) throw new StoreError(
    'CHARACTER_IMAGE_JOB_STATUS_INVALID',
    'Character image job changed before its lease could be acquired',
    { job_id: jobId },
  );
  appendCharacterImageJobEvent(
    db,
    jobId,
    job.status,
    'submitting',
    'Character image job lease acquired',
    now,
  );
  return getCharacterImageJob(db, jobId);
}

export function markCharacterImageSubmitIntent(
  db: Database.Database,
  jobId: string,
  leaseToken: string,
  providerClientId: string,
): CharacterImageJob {
  if (!providerClientId.trim()) throw new StoreError(
    'INPUT_INVALID',
    'Provider client id must not be empty',
  );
  return runWriteTransaction(db, () => {
    const job = getCharacterImageJob(db, jobId);
    requireCharacterImageLeaseToken(job, leaseToken);
    if (job.status !== 'submitting') throw new StoreError(
      'CHARACTER_IMAGE_JOB_STATUS_INVALID',
      'Submit intent requires a submitting character image job',
    );
    if (job.provider_client_id !== null) {
      if (job.provider_client_id !== providerClientId.trim()) {
        throw new StoreError(
          'CHARACTER_IMAGE_SUBMIT_INTENT_CONFLICT',
          'Character image submit intent is immutable until recovery clears it',
          { job_id: jobId, provider_client_id: job.provider_client_id },
        );
      }
      return job;
    }
    const conflict = db.prepare(`SELECT id FROM character_image_jobs
      WHERE provider_client_id = ? AND id <> ?`)
      .get(providerClientId.trim(), jobId) as { id: string } | undefined;
    if (conflict) throw new StoreError(
      'CHARACTER_IMAGE_SUBMIT_INTENT_CONFLICT',
      'Provider client id is already owned by another character image job',
      { job_id: jobId, conflicting_job_id: conflict.id,
        provider_client_id: providerClientId.trim() },
    );
    const now = new Date().toISOString();
    const result = db.prepare(`UPDATE character_image_jobs
      SET provider_client_id = ?, heartbeat_at = ?, updated_at = ?
      WHERE id = ? AND status = 'submitting' AND lease_token = ?`)
      .run(providerClientId.trim(), now, now, jobId, leaseToken);
    if (result.changes !== 1) throw staleLease(jobId);
    return getCharacterImageJob(db, jobId);
  });
}

export function clearCharacterImageProviderTask(
  db: Database.Database,
  jobId: string,
  leaseToken: string,
): CharacterImageJob {
  return runWriteTransaction(db, () => {
    const job = getCharacterImageJob(db, jobId);
    requireCharacterImageLeaseToken(job, leaseToken);
    if (job.status !== 'submitting') throw new StoreError(
      'CHARACTER_IMAGE_JOB_STATUS_INVALID',
      'Provider task reset requires a submitting character image job',
    );
    const now = new Date().toISOString();
    const result = db.prepare(`UPDATE character_image_jobs
      SET provider_client_id = NULL, provider_job_id = NULL, updated_at = ?
      WHERE id = ? AND status = 'submitting' AND lease_token = ?`)
      .run(now, jobId, leaseToken);
    if (result.changes !== 1) throw staleLease(jobId);
    return getCharacterImageJob(db, jobId);
  });
}

export function markCharacterImageJobQueued(
  db: Database.Database,
  jobId: string,
  leaseToken: string,
  providerJobId: string,
): CharacterImageJob {
  if (!providerJobId.trim()) throw new StoreError(
    'INPUT_INVALID',
    'Provider job id must not be empty',
  );
  return transitionActive(db, jobId, leaseToken, 'submitting', 'queued',
    'Provider accepted character image job', providerJobId.trim());
}

export function markCharacterImageJobRunning(
  db: Database.Database,
  jobId: string,
  leaseToken: string,
): CharacterImageJob {
  return transitionActive(db, jobId, leaseToken, 'queued', 'running',
    'Provider started character image job');
}

function transitionActive(db: Database.Database, jobId: string,
  leaseToken: string, fromStatus: 'submitting' | 'queued',
  toStatus: 'queued' | 'running', message: string,
  providerJobId?: string): CharacterImageJob {
  return runWriteTransaction(db, () => {
    const job = getCharacterImageJob(db, jobId);
    requireCharacterImageTransition(job, toStatus);
    requireCharacterImageLeaseToken(job, leaseToken);
    if (toStatus === 'queued' && job.provider_client_id === null) {
      throw new StoreError(
        'CHARACTER_IMAGE_SUBMIT_INTENT_REQUIRED',
        'Provider submit intent must be persisted before queuing image work',
        { job_id: jobId },
      );
    }
    const now = new Date().toISOString();
    const result = providerJobId === undefined
      ? db.prepare(`UPDATE character_image_jobs SET status = ?,
          heartbeat_at = ?, updated_at = ?
          WHERE id = ? AND status = ? AND lease_token = ?`)
        .run(toStatus, now, now, jobId, fromStatus, leaseToken)
      : db.prepare(`UPDATE character_image_jobs SET status = ?,
          provider_job_id = ?, heartbeat_at = ?, updated_at = ?
          WHERE id = ? AND status = ? AND lease_token = ?`)
        .run(toStatus, providerJobId, now, now, jobId, fromStatus, leaseToken);
    if (result.changes !== 1) throw staleLease(jobId);
    appendCharacterImageJobEvent(db, jobId, fromStatus, toStatus,
      message, now);
    return getCharacterImageJob(db, jobId);
  });
}

function staleLease(jobId: string): StoreError {
  return new StoreError(
    'CHARACTER_IMAGE_JOB_LEASE_INVALID',
    'Character image job changed or its lease is no longer current',
    { job_id: jobId },
  );
}
