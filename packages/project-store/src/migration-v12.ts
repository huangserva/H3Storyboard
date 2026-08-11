import type Database from 'better-sqlite3';

function addColumn(db: Database.Database, table: string,
  column: string, definition: string): void {
  const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (!columns.some(({ name }) => name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function addRepresentativeTakeGate(db: Database.Database): void {
  addColumn(db, 'shot_actuals', 'is_representative',
    'INTEGER NOT NULL DEFAULT 0 CHECK (is_representative IN (0, 1))');
  addColumn(db, 'shot_actuals', 'representative_status',
    "TEXT NOT NULL DEFAULT 'none' CHECK (representative_status IN ('none', 'pending', 'approved', 'rejected'))");
  addColumn(db, 'shot_actuals', 'approved_at', 'TEXT');
  addColumn(db, 'h3_jobs', 'gate_override_reason', 'TEXT');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_actuals_representative
    ON shot_actuals(shot_plan_id) WHERE is_representative = 1`);
}
