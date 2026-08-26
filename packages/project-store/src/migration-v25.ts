import type Database from 'better-sqlite3';

function columns(
  database: Database.Database,
  table: string,
): Set<string> {
  return new Set((database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>).map(({ name }) => name));
}

function addColumn(
  database: Database.Database,
  table: string,
  name: string,
  sql: string,
): void {
  if (!columns(database, table).has(name)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${sql}`);
  }
}

export function createPlanReviewWorkflow(
  database: Database.Database,
): void {
  addColumn(database, 'projects', 'active_script_compilation_id',
    'active_script_compilation_id TEXT REFERENCES script_compilations(id)');
  addColumn(database, 'script_compilations', 'status',
    "status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'superseded'))");
  addColumn(database, 'script_compilations', 'revision',
    'revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)');
  addColumn(database, 'script_compilations', 'approved_at',
    'approved_at TEXT');
  addColumn(database, 'script_compilations', 'superseded_at',
    'superseded_at TEXT');
  addColumn(database, 'shot_plans', 'planning_revision',
    'planning_revision INTEGER NOT NULL DEFAULT 0 CHECK (planning_revision >= 0)');
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_script_compilations_one_approved
      ON script_compilations(project_id) WHERE status = 'approved';
    CREATE INDEX IF NOT EXISTS idx_shot_plans_planning_status
      ON shot_plans(project_id, planning_status, ordinal);
  `);
}
