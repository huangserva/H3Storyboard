import type Database from 'better-sqlite3';

export function addH3BatchFairnessCursor(db: Database.Database): void {
  const columns = db.pragma('table_info(h3_job_batches)') as
    Array<{ name: string }>;
  if (!columns.some(({ name }) => name === 'last_claimed_at')) db.exec(
    'ALTER TABLE h3_job_batches ADD COLUMN last_claimed_at TEXT',
  );
}
