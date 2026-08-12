import type Database from 'better-sqlite3';

export function addProviderSubmitIntent(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(h3_jobs)').all() as
    Array<{ name: string }>;
  if (!columns.some(({ name }) => name === 'provider_client_id')) {
    db.exec('ALTER TABLE h3_jobs ADD COLUMN provider_client_id TEXT;');
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_provider_client
    ON h3_jobs(provider_client_id);`);
}
