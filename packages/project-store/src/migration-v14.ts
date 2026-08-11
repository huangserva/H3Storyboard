import type Database from 'better-sqlite3';

export function addWorkerCancellationReason(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(h3_jobs)').all() as
    Array<{ name: string }>;
  if (!columns.some(({ name }) => name === 'cancel_reason')) {
    db.exec('ALTER TABLE h3_jobs ADD COLUMN cancel_reason TEXT;');
  }
}
