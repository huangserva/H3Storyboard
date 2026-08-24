import type Database from 'better-sqlite3';

export function enforceSingleCharacterImageRetry(
  db: Database.Database,
): void {
  const columns = db.pragma('table_info(character_image_jobs)') as
    Array<{ name: string }>;
  if (!columns.some(({ name }) => name === 'retry_of_job_id')) db.exec(
    `ALTER TABLE character_image_jobs ADD COLUMN retry_of_job_id TEXT
      REFERENCES character_image_jobs(id)`,
  );
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_character_image_jobs_retry
      ON character_image_jobs(retry_of_job_id, created_at, id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_character_image_jobs_single_retry
      ON character_image_jobs(retry_of_job_id)
      WHERE retry_of_job_id IS NOT NULL;
  `);
}
