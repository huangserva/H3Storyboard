import type {
  CharacterImageFailureCode,
  CharacterImageJob,
  CharacterImageJobEvent,
} from '@h3storyboard/protocol';
import { CharacterImageFailureCodeSchema } from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { StoreError } from './errors.js';
import { mapCharacterImageJobEvent } from './row-mappers.js';
import { runWriteTransaction } from './transactions.js';
import {
  appendCharacterImageJobEvent,
  getCharacterImageJob,
  requireCharacterImageLeaseDuration,
  requireCharacterImageLeaseToken,
  requireCharacterImageTransition,
} from './character-image-job-support.js';

const activeStatuses = ['submitting', 'queued', 'running'] as const;

export function listCharacterImageJobEvents(
  db: Database.Database,
  jobId: string,
): CharacterImageJobEvent[] {
  getCharacterImageJob(db, jobId);
  return db.prepare(`SELECT * FROM character_image_job_events
    WHERE job_id = ? ORDER BY rowid`).all(jobId)
    .map(mapCharacterImageJobEvent);
}

export function heartbeatCharacterImageJob(
  db: Database.Database,
  jobId: string,
  leaseToken: string,
  leaseDurationMs = 60_000,
): CharacterImageJob {
  requireCharacterImageLeaseDuration(leaseDurationMs);
  return runWriteTransaction(db, () => {
    const job = getCharacterImageJob(db, jobId);
    if (!activeStatuses.includes(
      job.status as (typeof activeStatuses)[number],
    )) throw new StoreError(
      'CHARACTER_IMAGE_JOB_STATUS_INVALID',
      'Only an active character image job lease can be renewed',
      { job_id: jobId, status: job.status },
    );
    requireCharacterImageLeaseToken(job, leaseToken);
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const leaseExpiresAt = new Date(
      nowDate.getTime() + leaseDurationMs,
    ).toISOString();
    const result = db.prepare(`UPDATE character_image_jobs
      SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND status = ? AND lease_token = ?`)
      .run(now, leaseExpiresAt, now, jobId, job.status, leaseToken);
    if (result.changes !== 1) throw staleLease(jobId);
    return getCharacterImageJob(db, jobId);
  });
}

export function failCharacterImageJob(
  db: Database.Database,
  jobId: string,
  leaseToken: string,
  errorCode: CharacterImageFailureCode,
  errorMessage: string,
): CharacterImageJob {
  return finishWithFailure(
    db,
    jobId,
    leaseToken,
    'failed',
    errorCode,
    errorMessage,
  );
}

export function deferCharacterImageJob(
  db: Database.Database,
  jobId: string,
  leaseToken: string,
  errorCode: CharacterImageFailureCode,
  errorMessage: string,
): CharacterImageJob {
  return finishWithFailure(
    db,
    jobId,
    leaseToken,
    'timed_out',
    errorCode,
    errorMessage,
  );
}

function finishWithFailure(
  db: Database.Database,
  jobId: string,
  leaseToken: string,
  status: 'failed' | 'timed_out',
  errorCode: CharacterImageFailureCode,
  errorMessage: string,
): CharacterImageJob {
  const code = requireFailureCode(errorCode);
  if (!errorMessage.trim()) throw new StoreError(
    'INPUT_INVALID',
    'Failed character image jobs require an error code and message',
  );
  return runWriteTransaction(db, () => {
    const job = getCharacterImageJob(db, jobId);
    requireCharacterImageTransition(job, status);
    requireCharacterImageLeaseToken(job, leaseToken);
    const now = new Date().toISOString();
    const result = db.prepare(`UPDATE character_image_jobs SET status = ?,
      error_code = ?, error_message = ?, completed_at = ?, updated_at = ?,
      lease_token = NULL, lease_expires_at = NULL, heartbeat_at = ?
      WHERE id = ? AND status = ? AND lease_token = ?`)
      .run(status, code, errorMessage.trim(), now, now, now,
        jobId, job.status, leaseToken);
    if (result.changes !== 1) throw staleLease(jobId);
    appendCharacterImageJobEvent(
      db,
      jobId,
      job.status,
      status,
      errorMessage.trim(),
      now,
      code,
    );
    return getCharacterImageJob(db, jobId);
  });
}

export function forceFailCharacterImageJob(
  db: Database.Database,
  jobId: string,
  leaseToken: string,
  errorCode: CharacterImageFailureCode,
  errorMessage: string,
): CharacterImageJob {
  const code = requireFailureCode(errorCode);
  const message = errorMessage.trim() || 'Character image worker failed';
  return runWriteTransaction(db, () => {
    const job = getCharacterImageJob(db, jobId);
    if (!activeStatuses.includes(
      job.status as (typeof activeStatuses)[number],
    ) || job.lease_token !== leaseToken) return job;
    const now = new Date().toISOString();
    const result = db.prepare(`UPDATE character_image_jobs SET status = 'failed',
      error_code = ?, error_message = ?, completed_at = ?, updated_at = ?,
      lease_token = NULL, lease_expires_at = NULL, heartbeat_at = ?
      WHERE id = ? AND status = ? AND lease_token = ?`)
      .run(code, message, now, now, now, jobId, job.status, leaseToken);
    if (result.changes !== 1) return getCharacterImageJob(db, jobId);
    appendCharacterImageJobEvent(
      db,
      jobId,
      job.status,
      'failed',
      message,
      now,
      code,
    );
    return getCharacterImageJob(db, jobId);
  });
}

export function cancelCharacterImageJob(
  db: Database.Database,
  jobId: string,
  reason = 'Canceled by user',
): CharacterImageJob {
  if (!reason.trim()) throw new StoreError(
    'INPUT_INVALID',
    'Canceled character image jobs require a non-empty reason',
  );
  return runWriteTransaction(db, () => {
    const job = getCharacterImageJob(db, jobId);
    if (job.status === 'canceled') return job;
    requireCharacterImageTransition(job, 'canceled');
    const now = new Date().toISOString();
    const result = db.prepare(`UPDATE character_image_jobs
      SET status = 'canceled', cancel_reason = ?, completed_at = ?,
          updated_at = ?, lease_token = NULL, lease_expires_at = NULL,
          heartbeat_at = ? WHERE id = ? AND status = ?`)
      .run(reason.trim(), now, now, now, jobId, job.status);
    if (result.changes !== 1) throw new StoreError(
      'CHARACTER_IMAGE_JOB_STATUS_INVALID',
      'Character image job changed before cancellation could be recorded',
      { job_id: jobId },
    );
    appendCharacterImageJobEvent(
      db,
      jobId,
      job.status,
      'canceled',
      reason.trim(),
      now,
    );
    return getCharacterImageJob(db, jobId);
  });
}

export function recoverExpiredCharacterImageJobs(
  db: Database.Database,
  nowDate = new Date(),
): number {
  if (Number.isNaN(nowDate.getTime())) throw new StoreError(
    'INPUT_INVALID',
    'Recovery time must be valid',
  );
  return runWriteTransaction(db, () => {
    const now = nowDate.toISOString();
    const rows = db.prepare(`SELECT id FROM character_image_jobs
      WHERE status IN ('submitting', 'queued', 'running')
        AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
      ORDER BY created_at, id`).all(now) as Array<{ id: string }>;
    let recovered = 0;
    for (const { id } of rows) {
      const job = getCharacterImageJob(db, id);
      requireCharacterImageTransition(job, 'timed_out');
      const result = db.prepare(`UPDATE character_image_jobs
        SET status = 'timed_out', error_code = 'IMAGE_COMFY_TIMEOUT',
            error_message = 'Worker lease expired', completed_at = ?,
            updated_at = ?, lease_token = NULL, lease_expires_at = NULL
        WHERE id = ? AND status = ? AND lease_token = ?`)
        .run(now, now, id, job.status, job.lease_token);
      if (result.changes !== 1) continue;
      appendCharacterImageJobEvent(
        db,
        id,
        job.status,
        'timed_out',
        'Worker lease expired',
        now,
        'IMAGE_COMFY_TIMEOUT',
      );
      recovered += 1;
    }
    return recovered;
  });
}

function staleLease(jobId: string): StoreError {
  return new StoreError(
    'CHARACTER_IMAGE_JOB_LEASE_INVALID',
    'Character image job changed or its lease is no longer current',
    { job_id: jobId },
  );
}

function requireFailureCode(value: unknown): CharacterImageFailureCode {
  const parsed = CharacterImageFailureCodeSchema.safeParse(value);
  if (!parsed.success) throw new StoreError(
    'INPUT_INVALID',
    'Character image failure code is not part of the protocol enum',
    parsed.error.issues,
  );
  return parsed.data;
}
