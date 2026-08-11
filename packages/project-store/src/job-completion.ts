import type { H3Job } from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { StoreError } from './errors.js';
import {
  appendJobEvent,
  getJob,
  requireJobTransition,
  requireLeaseToken,
} from './job-support.js';

export function completeH3Job(
  db: Database.Database,
  jobId: string,
  leaseToken: string,
  outputAssetId: string,
): H3Job {
  const transaction = db.transaction(() => {
    const job = getJob(db, jobId);
    if (job.status === 'completed') {
      if (job.output_asset_id !== outputAssetId) {
        throw new StoreError(
          'H3_JOB_OUTPUT_MISMATCH',
          'Completed job already has a different output asset',
          {
            job_id: jobId,
            output_asset_id: job.output_asset_id,
            requested_output_asset_id: outputAssetId,
          },
        );
      }
      throw new StoreError(
        'H3_JOB_STATUS_INVALID',
        'Completed H3 jobs reject repeated provider callbacks',
        { job_id: jobId, status: job.status },
      );
    }
    requireJobTransition(job, 'completed');
    requireLeaseToken(job, leaseToken);
    if (job.input_bindings.some(({ asset_id }) => asset_id === outputAssetId)) {
      throw new StoreError(
        'H3_JOB_OUTPUT_MISMATCH',
        'H3 output must be a new asset, not one of the job inputs',
        { job_id: jobId, asset_id: outputAssetId },
      );
    }
    const asset = db
      .prepare(
        `SELECT project_id, kind, producer_job_id FROM assets WHERE id = ?`,
      )
      .get(outputAssetId) as
      | { project_id: string; kind: string; producer_job_id: string | null }
      | undefined;
    if (!asset) {
      throw new StoreError('ASSET_NOT_FOUND', 'Output asset does not exist', {
        asset_id: outputAssetId,
      });
    }
    if (asset.project_id !== job.project_id) {
      throw new StoreError(
        'ASSET_PROJECT_MISMATCH',
        'Output asset belongs to another project',
        { asset_id: outputAssetId, project_id: job.project_id },
      );
    }
    if (asset.kind !== 'video') {
      throw new StoreError(
        'OUTPUT_ASSET_KIND_INVALID',
        'H3 output asset must be a video',
        { asset_id: outputAssetId, asset_kind: asset.kind },
      );
    }
    if (asset.producer_job_id !== null) {
      throw outputAlreadyClaimed(outputAssetId, asset.producer_job_id);
    }
    const now = new Date().toISOString();
    const claimedAsset = db.prepare(
      `UPDATE assets SET producer_job_id = ?
       WHERE id = ? AND producer_job_id IS NULL`,
    ).run(jobId, outputAssetId);
    if (claimedAsset.changes !== 1) {
      const producer = db
        .prepare('SELECT producer_job_id FROM assets WHERE id = ?')
        .get(outputAssetId) as { producer_job_id: string | null } | undefined;
      throw outputAlreadyClaimed(outputAssetId, producer?.producer_job_id ?? null);
    }
    const result = db.prepare(
      `UPDATE h3_jobs SET status = 'completed', output_asset_id = ?,
       completed_at = ?, updated_at = ?, lease_expires_at = NULL,
       heartbeat_at = ?, lease_token = NULL
       WHERE id = ? AND status = 'running' AND lease_token = ?`,
    ).run(outputAssetId, now, now, now, jobId, leaseToken);
    if (result.changes !== 1) {
      throw new StoreError(
        'H3_JOB_STATUS_INVALID',
        'H3 job changed before completion could be recorded',
        { job_id: jobId },
      );
    }
    appendJobEvent(
      db,
      jobId,
      'running',
      'completed',
      'Job completed',
      now,
    );
    return getJob(db, jobId);
  });
  return transaction.immediate();
}

function outputAlreadyClaimed(
  outputAssetId: string,
  producerJobId: string | null,
): StoreError {
  return new StoreError(
    'OUTPUT_ASSET_ALREADY_CLAIMED',
    'Output asset is already assigned to another H3 job',
    { output_asset_id: outputAssetId, producer_job_id: producerJobId },
  );
}
