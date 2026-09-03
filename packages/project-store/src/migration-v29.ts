import type Database from 'better-sqlite3';

/** ADR 0003: structured H3 prompt spec on plans; skill revision on jobs. */
export function addFilmStudioPromptCompilation(db: Database.Database): void {
  const shotColumns = db.prepare('PRAGMA table_info(shot_plans)').all() as
    Array<{ name: string }>;
  if (!shotColumns.some(({ name }) => name === 'h3_prompt_spec_json')) {
    db.exec('ALTER TABLE shot_plans ADD COLUMN h3_prompt_spec_json TEXT;');
  }
  const jobColumns = db.prepare('PRAGMA table_info(h3_jobs)').all() as
    Array<{ name: string }>;
  if (!jobColumns.some(({ name }) => name === 'film_studio_revision')) {
    db.exec('ALTER TABLE h3_jobs ADD COLUMN film_studio_revision TEXT;');
  }
}
