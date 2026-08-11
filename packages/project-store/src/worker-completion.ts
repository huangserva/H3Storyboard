import type { Asset, H3Job, ShotActual } from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { createAsset } from './asset-operations.js';
import { StoreError } from './errors.js';
import { completeH3Job } from './job-completion.js';
import { createShotActual } from './shot-operations.js';
import { runWriteTransaction } from './transactions.js';

export interface WorkerOutputInput {
  name: string;
  relative_path: string;
  content_hash: string;
  observed_description: string;
}

export interface WorkerOutputResult {
  job: H3Job;
  asset: Asset;
  actual: ShotActual;
}

export function finalizeWorkerOutput(db: Database.Database, jobId: string,
  leaseToken: string, input: WorkerOutputInput): WorkerOutputResult {
  if (!/^sha256:[a-f0-9]{64}$/.test(input.content_hash)) throw new StoreError(
    'H3_OUTPUT_HASH_INVALID', 'Worker outputs require a real sha256 content hash');
  return runWriteTransaction(db, () => {
    const row = db.prepare(`SELECT project_id, shot_plan_id FROM h3_jobs
      WHERE id = ?`).get(jobId) as { project_id: string;
        shot_plan_id: string } | undefined;
    if (!row) throw new StoreError('H3_JOB_NOT_FOUND',
      'H3 job does not exist', { job_id: jobId });
    const asset = createAsset(db, row.project_id, { kind: 'video',
      name: input.name, relative_path: input.relative_path,
      content_hash: input.content_hash, status: 'candidate' });
    const job = completeH3Job(db, jobId, leaseToken, asset.id);
    const actual = createShotActual(db, row.shot_plan_id, {
      job_id: jobId, output_asset_id: asset.id,
      observed_description: input.observed_description,
      deviation_notes: '', qc_verdict: 'pending',
    });
    return { job, asset, actual };
  });
}
