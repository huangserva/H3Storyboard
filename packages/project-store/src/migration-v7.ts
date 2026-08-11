import type Database from 'better-sqlite3';

export function createCharacters(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      name TEXT NOT NULL,
      canonical_appearance TEXT NOT NULL,
      seed_family_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('candidate', 'approved', 'archived')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_characters_project
      ON characters(project_id, status, created_at, id);

    CREATE TABLE IF NOT EXISTS character_references (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL REFERENCES characters(id),
      uri TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
      content_hash TEXT,
      derived_from TEXT REFERENCES character_references(id),
      sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_character_references_character
      ON character_references(character_id, sort_order, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_character_references_source
      ON character_references(derived_from);
  `);
}
