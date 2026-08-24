import type Database from 'better-sqlite3';

export function addJobAudioMode(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(h3_jobs)').all() as
    Array<{ name: string }>;
  if (!columns.some(({ name }) => name === 'audio_mode')) {
    db.exec(`ALTER TABLE h3_jobs ADD COLUMN audio_mode TEXT NOT NULL
      DEFAULT 'h3_native'
      CHECK (audio_mode IN ('h3_native', 'silent'));`);
  }
}
