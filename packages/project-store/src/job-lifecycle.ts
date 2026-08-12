import type { H3Job, JobEvent } from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { StoreError } from './errors.js';
import { mapJobEvent } from './row-mappers.js';
import {
  appendJobEvent,
  getJob,
  requireLeaseDuration,
  requireJobTransition,
  requireLeaseToken,
} from './job-support.js';
import { runWriteTransaction } from './transactions.js';

const activeStatuses = ['submitting', 'queued', 'running'] as const;

export function listH3JobEvents(
  db: Database.Database,
  jobId: string,
): JobEvent[] {
  getJob(db, jobId);
  return db
    .prepare('SELECT * FROM job_events WHERE job_id = ? ORDER BY rowid')
    .all(jobId)
    .map(mapJobEvent);
}

export function heartbeatH3Job(
  db: Database.Database,
  jobId: string,
  leaseToken: string,
  leaseDurationMs = 60_000,
): H3Job {
  requireLeaseDuration(leaseDurationMs);
  return runWriteTransaction(db, () => {
    const job = getJob(db, jobId);
    if (!activeStatuses.includes(job.status as (typeof activeStatuses)[number])) {
      throw new StoreError(
        'H3_JOB_STATUS_INVALID',
        'Only an active H3 job lease can be renewed',
        { job_id: jobId, status: job.status },
      );
    }
    requireLeaseToken(job, leaseToken);
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const leaseExpiresAt = new Date(
      nowDate.getTime() + leaseDurationMs,
    ).toISOString();
    const result = db.prepare(
      `UPDATE h3_jobs SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ?
       WHERE id = ? AND status = ? AND lease_token = ?`,
    ).run(now, leaseExpiresAt, now, jobId, job.status, leaseToken);
    if (result.changes !== 1) throw staleLease(jobId);
    return getJob(db, jobId);
  });
}

export function failH3Job(
  db: Database.Database,
  jobId: string,
  leaseToken: string,
  errorCode: string,
  errorMessage: string,
): H3Job {
  if (!errorCode.trim() || !errorMessage.trim()) {
    throw new StoreError(
      'INPUT_INVALID',
      'Failed jobs require an error code and message',
    );
  }
  return runWriteTransaction(db, () => {
    const job = getJob(db, jobId);
    requireJobTransition(job, 'failed');
    requireLeaseToken(job, leaseToken);
    const now = new Date().toISOString();
    const result = db.prepare(
      `UPDATE h3_jobs SET status = 'failed', error_code = ?, error_message = ?,
       completed_at = ?, updated_at = ?, lease_token = NULL,
       lease_expires_at = NULL, heartbeat_at = ?
       WHERE id = ? AND status = ? AND lease_token = ?`,
    ).run(
      errorCode,
      errorMessage,
      now,
      now,
      now,
      jobId,
      job.status,
      leaseToken,
    );
    if (result.changes !== 1) throw staleLease(jobId);
    appendJobEvent(
      db,
      jobId,
      job.status,
      'failed',
      errorMessage,
      now,
      errorCode,
    );
    return getJob(db, jobId);
  });
}

export function forceFailH3Job(db: Database.Database, jobId: string,
  leaseToken: string, errorCode: string, errorMessage: string): H3Job {
  const code = errorCode.trim() || 'H3_WORKER_FAILED';
  const message = errorMessage.trim() || 'H3 worker failed without details';
  return runWriteTransaction(db, () => {
    const job = getJob(db, jobId);
    if (!activeStatuses.includes(job.status as (typeof activeStatuses)[number]) ||
      job.lease_token !== leaseToken) return job;
    const now = new Date().toISOString();
    db.prepare(`UPDATE h3_jobs SET status = 'failed', error_code = ?,
      error_message = ?, completed_at = ?, updated_at = ?, lease_token = NULL,
      lease_expires_at = NULL, heartbeat_at = ? WHERE id = ? AND lease_token = ?`)
      .run(code, message, now, now, now, jobId, leaseToken);
    appendJobEvent(db, jobId, job.status, 'failed', message, now, code);
    return getJob(db, jobId);
  });
}

export function deferH3Job(db: Database.Database, jobId: string,
  leaseToken: string, errorCode: string, errorMessage: string): H3Job {
  const message = errorMessage.trim() || 'Provider polling timed out';
  return runWriteTransaction(db, () => {
    const job = getJob(db, jobId);
    requireJobTransition(job, 'timed_out');
    requireLeaseToken(job, leaseToken);
    const now = new Date().toISOString();
    const result = db.prepare(`UPDATE h3_jobs SET status = 'timed_out',
      error_code = ?, error_message = ?, completed_at = ?, updated_at = ?,
      lease_token = NULL, lease_expires_at = NULL, heartbeat_at = ?
      WHERE id = ? AND status = ? AND lease_token = ?`)
      .run(errorCode, message, now, now, now, jobId, job.status, leaseToken);
    if (result.changes !== 1) throw staleLease(jobId);
    appendJobEvent(db, jobId, job.status, 'timed_out', message, now, errorCode);
    return getJob(db, jobId);
  });
}

export function cancelH3Job(
  db: Database.Database,
  jobId: string,
  reason = 'Canceled by user',
): H3Job {
  if (!reason.trim()) throw new StoreError('INPUT_INVALID',
    'Canceled jobs require a non-empty reason');
  return runWriteTransaction(db, () => {
    const job = getJob(db, jobId);
    if (job.status === 'canceled') return job;
    requireJobTransition(job, 'canceled');
    const now = new Date().toISOString();
    const result = db.prepare(
      `UPDATE h3_jobs SET status = 'canceled', cancel_reason = ?,
       completed_at = ?, updated_at = ?,
       lease_token = NULL, lease_expires_at = NULL, heartbeat_at = ?
       WHERE id = ? AND status = ?`,
    ).run(reason.trim(), now, now, now, jobId, job.status);
    if (result.changes !== 1) {
      throw new StoreError(
        'H3_JOB_STATUS_INVALID',
        'H3 job changed before cancellation could be recorded',
        { job_id: jobId },
      );
    }
    appendJobEvent(db, jobId, job.status, 'canceled', reason.trim(), now);
    return getJob(db, jobId);
  });
}

export function recoverExpiredH3Jobs(
  db: Database.Database,
  nowDate = new Date(),
): number {
  if (Number.isNaN(nowDate.getTime())) {
    throw new StoreError('INPUT_INVALID', 'Recovery time must be valid');
  }
  return runWriteTransaction(db, () => {
    const now = nowDate.toISOString();
    const rows = db.prepare(
      `SELECT * FROM h3_jobs
       WHERE status IN ('submitting', 'queued', 'running')
         AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
       ORDER BY created_at, id`,
    ).all(now).map((row) => getJob(db, (row as { id: string }).id));
    let recovered = 0;
    for (const job of rows) {
      requireJobTransition(job, 'timed_out');
      const result = db.prepare(
        `UPDATE h3_jobs SET status = 'timed_out', error_code = 'LEASE_EXPIRED',
         error_message = 'Worker lease expired', completed_at = ?, updated_at = ?,
         lease_token = NULL, lease_expires_at = NULL
         WHERE id = ? AND status = ? AND lease_token = ?`,
      ).run(now, now, job.id, job.status, job.lease_token);
      if (result.changes !== 1) continue;
      appendJobEvent(
        db,
        job.id,
        job.status,
        'timed_out',
        'Worker lease expired',
        now,
        'LEASE_EXPIRED',
      );
      recovered += 1;
    }
    return recovered;
  });
}

function staleLease(jobId: string): StoreError {
  return new StoreError(
    'H3_JOB_LEASE_INVALID',
    'H3 job changed or its lease is no longer current',
    { job_id: jobId },
  );
}
