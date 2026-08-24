import type {
  CharacterImageFailureCode,
  CharacterImageJob,
  CharacterImageJobStatus,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { StoreError } from './errors.js';
import { mapCharacterImageJob } from './row-mappers.js';

const transitions: Readonly<Record<CharacterImageJobStatus,
  readonly CharacterImageJobStatus[]>> = {
  draft: ['submitting', 'canceled'],
  submitting: ['queued', 'failed', 'canceled', 'timed_out'],
  queued: ['running', 'failed', 'canceled', 'timed_out'],
  running: ['completed', 'failed', 'canceled', 'timed_out'],
  completed: [],
  failed: [],
  canceled: [],
  timed_out: ['submitting'],
};

const MAX_LEASE_DURATION_MS = 24 * 60 * 60 * 1_000;

export function getCharacterImageJob(
  db: Database.Database,
  jobId: string,
): CharacterImageJob {
  const row = db.prepare(
    'SELECT * FROM character_image_jobs WHERE id = ?',
  ).get(jobId);
  if (!row) throw new StoreError(
    'CHARACTER_IMAGE_JOB_NOT_FOUND',
    'Character image job does not exist',
    { job_id: jobId },
  );
  return mapCharacterImageJob(row);
}

export function appendCharacterImageJobEvent(
  db: Database.Database,
  jobId: string,
  fromStatus: CharacterImageJobStatus | null,
  toStatus: CharacterImageJobStatus,
  message: string,
  now: string,
  errorCode: CharacterImageFailureCode | null = null,
): void {
  db.prepare(`INSERT INTO character_image_job_events
    (id, job_id, from_status, to_status, error_code, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), jobId, fromStatus, toStatus, errorCode, message, now);
}

export function requireCharacterImageTransition(
  job: CharacterImageJob,
  toStatus: CharacterImageJobStatus,
): void {
  if (!transitions[job.status].includes(toStatus)) throw new StoreError(
    'CHARACTER_IMAGE_JOB_STATUS_INVALID',
    'Character image job is not in a valid state for this operation',
    { job_id: job.id, status: job.status, to_status: toStatus },
  );
}

export function requireCharacterImageLeaseToken(
  job: CharacterImageJob,
  leaseToken: string,
): void {
  if (job.lease_token !== leaseToken) throw new StoreError(
    'CHARACTER_IMAGE_JOB_LEASE_INVALID',
    'Character image job lease token is stale or invalid',
    { job_id: job.id, attempt: job.attempt },
  );
  if (job.lease_expires_at === null ||
    Date.parse(job.lease_expires_at) <= Date.now()) throw new StoreError(
    'CHARACTER_IMAGE_JOB_LEASE_EXPIRED',
    'Character image job lease has expired and must be recovered before retry',
    { job_id: job.id, attempt: job.attempt },
  );
}

export function requireCharacterImageLeaseDuration(
  leaseDurationMs: number,
): void {
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0 ||
    leaseDurationMs > MAX_LEASE_DURATION_MS) throw new StoreError(
    'INPUT_INVALID',
    'Lease duration must be an integer from 1 ms through 24 hours',
    { lease_duration_ms: leaseDurationMs },
  );
}
