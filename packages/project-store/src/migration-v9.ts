import type Database from 'better-sqlite3';

export function createModes(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS modes (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      capability_declaration_json TEXT NOT NULL,
      validation_status TEXT NOT NULL CHECK (
        validation_status IN ('candidate', 'validated', 'blocked')
      ),
      evidence TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_modes_key ON modes(key);
    CREATE INDEX IF NOT EXISTS idx_modes_status ON modes(validation_status, key);
  `);
}
