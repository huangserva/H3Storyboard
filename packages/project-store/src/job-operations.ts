import type { H3Job } from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { StoreError } from './errors.js';
import {
  appendJobEvent,
  getJob,
  requireJobTransition,
  requireLeaseToken,
} from './job-support.js';
import { runWriteTransaction } from './transactions.js';

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
