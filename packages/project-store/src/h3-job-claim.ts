import { H3_MAX_AUTO_ATTEMPTS, type H3Job } from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { StoreError } from './errors.js';
import {
  appendJobEvent,
  getJob,
  requireJobTransition,
  requireLeaseDuration,
} from './job-support.js';
import { runWriteTransaction } from './transactions.js';

export function claimH3Job(db: Database.Database, jobId: string,
  leaseDurationMs = 60_000): H3Job {
  requireLeaseDuration(leaseDurationMs);
  return runWriteTransaction(db, () => claimJob(db, jobId, leaseDurationMs));
}

export function claimNextH3Job(db: Database.Database,
  leaseDurationMs = 60_000): H3Job | null {
  requireLeaseDuration(leaseDurationMs);
  return runWriteTransaction(db, () => {
    const rows = db.prepare(`SELECT id, status, attempt, updated_at, error_code
      FROM h3_jobs
      WHERE provider = 'local_comfyui' AND (
        status = 'draft' OR (status = 'timed_out' AND attempt < ?)
      )
      ORDER BY CASE status WHEN 'draft' THEN 0 ELSE 1 END, created_at, id`)
      .all(H3_MAX_AUTO_ATTEMPTS) as Array<{
        id: string; status: string; attempt: number; updated_at: string;
        error_code: string | null;
      }>;
    const now = Date.now();
    const row = rows.find((candidate) => candidate.status === 'draft' ||
      candidate.error_code === 'LEASE_EXPIRED' ||
      now - Date.parse(candidate.updated_at) >= h3RetryBackoffMs(
        candidate.attempt));
    return row ? claimJob(db, row.id, leaseDurationMs) : null;
  });
}

function h3RetryBackoffMs(attempt: number): number {
  return Math.min(60_000, 2_000 * 2 ** Math.max(0, attempt - 1));
}

function claimJob(db: Database.Database, jobId: string,
  leaseDurationMs: number): H3Job {
  const job = getJob(db, jobId);
  requireJobTransition(job, 'submitting');
  const nowDate = new Date();
  if (job.lease_expires_at !== null &&
    Date.parse(job.lease_expires_at) > nowDate.getTime()) throw new StoreError(
    'H3_JOB_STATUS_INVALID',
    'H3 job already has an active lease',
    { job_id: jobId, lease_expires_at: job.lease_expires_at },
  );
  const now = nowDate.toISOString();
  const leaseExpiresAt = new Date(
    nowDate.getTime() + leaseDurationMs,
  ).toISOString();
  const leaseToken = randomUUID();
  const result = db.prepare(`UPDATE h3_jobs
    SET status = 'submitting', attempt = attempt + 1,
        lease_token = ?, lease_expires_at = ?, heartbeat_at = ?, updated_at = ?,
        provider_job_id = ?, output_asset_id = NULL,
        error_code = NULL, error_message = NULL, completed_at = NULL
    WHERE id = ? AND status = ?`).run(
      leaseToken, leaseExpiresAt, now, now,
      job.status === 'timed_out' ? job.provider_job_id : null,
      jobId, job.status,
    );
  if (result.changes !== 1) throw new StoreError(
    'H3_JOB_STATUS_INVALID',
    'H3 job changed before its lease could be acquired',
    { job_id: jobId },
  );
  appendJobEvent(db, jobId, job.status, 'submitting',
    'Job lease acquired', now);
  return getJob(db, jobId);
}
