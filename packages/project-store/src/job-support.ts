import type { H3Job } from '@h3storyboard/protocol';
import {
  assertJobTransition,
  JobTransitionError,
} from '@h3storyboard/task-engine';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { StoreError } from './errors.js';
import { mapH3Job } from './row-mappers.js';

const MAX_LEASE_DURATION_MS = 24 * 60 * 60 * 1_000;

export function getJob(db: Database.Database, jobId: string): H3Job {
  const row = db.prepare('SELECT * FROM h3_jobs WHERE id = ?').get(jobId);
  if (!row) {
    throw new StoreError('H3_JOB_NOT_FOUND', 'H3 job does not exist', {
      job_id: jobId,
    });
  }
  return mapH3Job(row);
}

export function appendJobEvent(
  db: Database.Database,
  jobId: string,
  fromStatus: H3Job['status'] | null,
  toStatus: H3Job['status'],
  message: string,
  now: string,
  errorCode: string | null = null,
): void {
  db.prepare(
    `INSERT INTO job_events
     (id, job_id, from_status, to_status, error_code, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    jobId,
    fromStatus,
    toStatus,
    errorCode,
    message,
    now,
  );
}

export function requireJobTransition(
  job: H3Job,
  toStatus: H3Job['status'],
): void {
  try {
    assertJobTransition(job.status, toStatus);
  } catch (error) {
    if (!(error instanceof JobTransitionError)) throw error;
    throw new StoreError(
      'H3_JOB_STATUS_INVALID',
      'H3 job is not in a valid state for this operation',
      { job_id: job.id, status: job.status, to_status: toStatus },
    );
  }
}

export function requireLeaseToken(job: H3Job, leaseToken: string): void {
  if (job.lease_token !== leaseToken) {
    throw new StoreError(
      'H3_JOB_LEASE_INVALID',
      'H3 job lease token is stale or invalid',
      { job_id: job.id, attempt: job.attempt },
    );
  }
  if (
    job.lease_expires_at === null ||
    Date.parse(job.lease_expires_at) <= Date.now()
  ) {
    throw new StoreError(
      'H3_JOB_LEASE_EXPIRED',
      'H3 job lease has expired and must be recovered before retry',
      { job_id: job.id, attempt: job.attempt },
    );
  }
}

export function requireLeaseDuration(leaseDurationMs: number): void {
  if (
    !Number.isSafeInteger(leaseDurationMs) ||
    leaseDurationMs <= 0 ||
    leaseDurationMs > MAX_LEASE_DURATION_MS
  ) {
    throw new StoreError(
      'INPUT_INVALID',
      'Lease duration must be an integer from 1 ms through 24 hours',
      { lease_duration_ms: leaseDurationMs },
    );
  }
}
