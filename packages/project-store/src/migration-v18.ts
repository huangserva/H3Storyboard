import type Database from 'better-sqlite3';

export function createCharacterAssetDerivations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_asset_derivations (
      asset_id TEXT PRIMARY KEY REFERENCES assets(id),
      source_asset_id TEXT NOT NULL REFERENCES assets(id),
      kind TEXT NOT NULL CHECK (
        kind IN ('character_angle_upload', 'identity_edit', 'variant_i2i')
      ),
      created_at TEXT NOT NULL,
      CHECK (asset_id <> source_asset_id)
    );
    CREATE INDEX IF NOT EXISTS idx_character_asset_derivations_source
      ON character_asset_derivations(source_asset_id, created_at);
  `);
}
