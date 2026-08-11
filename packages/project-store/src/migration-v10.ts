import type Database from 'better-sqlite3';

function addColumn(db: Database.Database, table: string,
  column: string, definition: string): void {
  const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (!columns.some(({ name }) => name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function createProductionContext(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_briefs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      brief_version INTEGER NOT NULL CHECK (brief_version > 0),
      mode_key TEXT NOT NULL REFERENCES modes(key),
      body_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (project_id, brief_version)
    );
    CREATE INDEX IF NOT EXISTS idx_briefs_project
      ON production_briefs(project_id, brief_version);
    CREATE INDEX IF NOT EXISTS idx_briefs_mode ON production_briefs(mode_key);

    CREATE TABLE IF NOT EXISTS project_generation_locks (
      project_id TEXT PRIMARY KEY REFERENCES projects(id),
      engaged INTEGER NOT NULL CHECK (engaged IN (0, 1)),
      engaged_at TEXT,
      released_at TEXT,
      reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_generation_locks_engaged
      ON project_generation_locks(engaged, project_id);
  `);
  addColumn(db, 'h3_jobs', 'lock_snapshot_json', 'TEXT');
}
