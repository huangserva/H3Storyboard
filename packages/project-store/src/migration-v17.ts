import type Database from 'better-sqlite3';

export function addCharacterReferenceUploads(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_reference_uploads (
      project_id TEXT NOT NULL REFERENCES projects(id),
      character_id TEXT NOT NULL REFERENCES characters(id),
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      asset_id TEXT NOT NULL REFERENCES assets(id),
      reference_id TEXT NOT NULL REFERENCES character_references(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, character_id, idempotency_key),
      UNIQUE (asset_id),
      UNIQUE (reference_id)
    );
    CREATE INDEX IF NOT EXISTS idx_character_reference_uploads_reference
      ON character_reference_uploads(reference_id);
  `);
}
