import type Database from 'better-sqlite3';

export function addScriptGenerationReview(
  database: Database.Database,
): void {
  const columns = database.pragma('table_info(script_versions)') as Array<{
    name: string;
  }>;
  if (columns.some(({ name }) => name === 'generation_review_json')) return;
  database.exec(
    'ALTER TABLE script_versions ADD COLUMN generation_review_json TEXT',
  );
}
