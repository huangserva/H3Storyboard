import type Database from 'better-sqlite3';

function addColumn(db: Database.Database, table: string,
  column: string, definition: string): void {
  const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (!columns.some(({ name }) => name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function addSemanticBindings(db: Database.Database): void {
  addColumn(db, 'shot_plans', 'semantic_references_json', 'TEXT');
  addColumn(db, 'shot_plans', 'opening_state_json', 'TEXT');
  addColumn(db, 'shot_plans', 'ending_state_json', 'TEXT');
  addColumn(db, 'h3_jobs', 'compiled_bindings_json', 'TEXT');
}
