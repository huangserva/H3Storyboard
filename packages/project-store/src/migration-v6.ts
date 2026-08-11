import type Database from 'better-sqlite3';

export function createCanvasNodes(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS canvas_nodes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      node_type TEXT NOT NULL CHECK (node_type IN ('shot_plan', 'character')),
      ref_id TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      width REAL NOT NULL CHECK (width > 0),
      height REAL NOT NULL CHECK (height > 0),
      z_index INTEGER NOT NULL CHECK (z_index >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (project_id, node_type, ref_id)
    );
    CREATE INDEX IF NOT EXISTS idx_canvas_nodes_project
      ON canvas_nodes(project_id, z_index, created_at, id);
  `);
}
