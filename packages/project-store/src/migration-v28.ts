import type Database from 'better-sqlite3';

export function addScriptGenerationInputs(
  database: Database.Database,
): void {
  addColumn(database, 'generation_input_json', 'TEXT');
  addColumn(database, 'generation_source_content', 'TEXT');
}

function addColumn(database: Database.Database, name: string,
  declaration: string): void {
  const columns = database.pragma('table_info(script_versions)') as Array<{
    name: string;
  }>;
  if (columns.some((column) => column.name === name)) return;
  database.exec(`ALTER TABLE script_versions ADD COLUMN ${name} ${declaration}`);
}
