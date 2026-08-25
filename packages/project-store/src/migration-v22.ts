import type Database from 'better-sqlite3';

export function createH3BatchOrchestration(db: Database.Database): void {
  const columns = db.pragma('table_info(h3_jobs)') as Array<{ name: string }>;
  if (!columns.some(({ name }) => name === 'retry_of_job_id')) db.exec(
    `ALTER TABLE h3_jobs ADD COLUMN retry_of_job_id TEXT
      REFERENCES h3_jobs(id)`,
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS h3_job_batches (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      request_fingerprint TEXT NOT NULL,
      claimed_count INTEGER NOT NULL DEFAULT 0 CHECK (claimed_count >= 0),
      last_claimed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (project_id, request_fingerprint)
    );
    CREATE TABLE IF NOT EXISTS h3_job_batch_items (
      batch_id TEXT NOT NULL REFERENCES h3_job_batches(id) ON DELETE CASCADE,
      shot_plan_id TEXT NOT NULL REFERENCES shot_plans(id),
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      original_job_id TEXT NOT NULL REFERENCES h3_jobs(id),
      current_job_id TEXT NOT NULL REFERENCES h3_jobs(id),
      PRIMARY KEY (batch_id, ordinal),
      UNIQUE (batch_id, shot_plan_id),
      UNIQUE (original_job_id),
      UNIQUE (current_job_id)
    );
    CREATE INDEX IF NOT EXISTS idx_h3_jobs_retry
      ON h3_jobs(retry_of_job_id, created_at, id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_h3_jobs_single_retry
      ON h3_jobs(retry_of_job_id) WHERE retry_of_job_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_h3_batches_project
      ON h3_job_batches(project_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_h3_batch_current_job
      ON h3_job_batch_items(current_job_id);
  `);
}
