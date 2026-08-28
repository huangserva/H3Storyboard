import type Database from 'better-sqlite3';

export function addScriptGenerationProvenance(
  database: Database.Database,
): void {
  addColumn(database, 'script_versions', 'generation_provider', 'TEXT');
  addColumn(database, 'script_versions', 'generation_model', 'TEXT');
}

function addColumn(
  database: Database.Database,
  table: string,
  column: string,
  declaration: string,
): void {
  const columns = database.pragma(`table_info(${table})`) as Array<{
    name: string;
  }>;
  if (columns.some(({ name }) => name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
}
