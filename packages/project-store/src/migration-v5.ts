import { AssetBindingSchema } from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { StoreError } from './errors.js';

export function migrateAssetProducers(db: Database.Database): void {
  db.exec(
    `ALTER TABLE assets ADD COLUMN producer_job_id TEXT REFERENCES h3_jobs(id)`,
  );
  const completed = db
    .prepare(
      `SELECT id, project_id, output_asset_id, input_bindings_json FROM h3_jobs
       WHERE status = 'completed' AND output_asset_id IS NOT NULL`,
    )
    .all() as Array<{
      id: string;
      project_id: string;
      output_asset_id: string;
      input_bindings_json: string;
    }>;
  const findAsset = db.prepare(
    `SELECT project_id, kind, producer_job_id FROM assets WHERE id = ?`,
  );
  const claim = db.prepare(
    `UPDATE assets SET producer_job_id = ?
     WHERE id = ? AND producer_job_id IS NULL`,
  );
  const outputs = new Set<string>();
  for (const job of completed) {
    const asset = findAsset.get(job.output_asset_id) as
      | { project_id: string; kind: string; producer_job_id: string | null }
      | undefined;
    const inputBindings = parseBindings(job.input_bindings_json);
    if (
      !asset ||
      asset.project_id !== job.project_id ||
      asset.kind !== 'video' ||
      inputBindings === null ||
      inputBindings.some(({ asset_id }) => asset_id === job.output_asset_id) ||
      outputs.has(job.output_asset_id) ||
      claim.run(job.id, job.output_asset_id).changes !== 1
    ) {
      throw new StoreError(
        'DATABASE_RECORD_INVALID',
        'Completed H3 jobs must have unique video output lineage',
        { job_id: job.id, output_asset_id: job.output_asset_id },
      );
    }
    outputs.add(job.output_asset_id);
  }
  db.exec(`
    CREATE UNIQUE INDEX idx_jobs_output_asset
      ON h3_jobs(output_asset_id) WHERE output_asset_id IS NOT NULL;
    CREATE UNIQUE INDEX idx_assets_producer_job
      ON assets(producer_job_id) WHERE producer_job_id IS NOT NULL;
  `);
}

function parseBindings(value: string) {
  try {
    const parsed = AssetBindingSchema.array().safeParse(
      JSON.parse(value) as unknown,
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
