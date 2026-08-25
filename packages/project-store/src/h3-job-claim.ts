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
    const now = new Date().toISOString();
    const row = db.prepare(`SELECT j.id, j.status, j.attempt, j.updated_at,
        j.error_code, bi.batch_id
      FROM h3_jobs j
      LEFT JOIN h3_job_batch_items bi ON bi.current_job_id = j.id
      LEFT JOIN h3_job_batches b ON b.id = bi.batch_id
      WHERE j.provider = 'local_comfyui' AND NOT EXISTS (
        SELECT 1 FROM h3_jobs retry WHERE retry.retry_of_job_id = j.id
      ) AND (j.status = 'draft' OR (
        j.status = 'timed_out' AND j.attempt < ? AND (
          j.error_code IN ('LEASE_EXPIRED', 'H3_RETRY_PROVIDER_RECOVERY') OR
          (julianday(?) - julianday(j.updated_at)) * 86400000 >=
            CASE
              WHEN j.attempt <= 1 THEN 2000
              WHEN j.attempt = 2 THEN 4000
              WHEN j.attempt = 3 THEN 8000
              WHEN j.attempt = 4 THEN 16000
              WHEN j.attempt = 5 THEN 32000
              ELSE 60000
            END
        )
      ))
      ORDER BY COALESCE(b.last_claimed_at, b.created_at, j.created_at),
        COALESCE(b.claimed_count, 0),
        CASE WHEN b.last_claimed_at IS NULL THEN 0 ELSE 1 END,
        COALESCE(b.rowid, j.rowid), COALESCE(bi.ordinal, 0), j.id
      LIMIT 1`).get(H3_MAX_AUTO_ATTEMPTS, now) as {
        id: string; status: string; attempt: number; updated_at: string;
        error_code: string | null; batch_id: string | null;
      } | undefined;
    if (!row) return null;
    const claimed = claimJob(db, row.id, leaseDurationMs);
    if (row.batch_id) db.prepare(`UPDATE h3_job_batches
      SET claimed_count = claimed_count + 1, last_claimed_at = ?, updated_at = ?
      WHERE id = ?`).run(claimed.updated_at, claimed.updated_at, row.batch_id);
    return claimed;
  });
}

function claimJob(db: Database.Database, jobId: string,
  leaseDurationMs: number): H3Job {
  const job = getJob(db, jobId);
  const successor = db.prepare(`SELECT id FROM h3_jobs
    WHERE retry_of_job_id = ? LIMIT 1`).get(jobId) as
    { id: string } | undefined;
  if (successor) throw new StoreError('H3_JOB_RETRY_INVALID',
    'An immutable retry has replaced this H3 job',
    { job_id: jobId, retry_job_id: successor.id });
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
