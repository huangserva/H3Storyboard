import type Database from 'better-sqlite3';

function addColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (!columns.some(({ name }) => name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function addAssetLifecycle(db: Database.Database): void {
  addColumn(db, 'assets', 'uri', 'TEXT');
  addColumn(db, 'assets', 'status', "TEXT CHECK (status IN ('candidate', 'approved', 'archived'))");
  addColumn(db, 'assets', 'replaces_asset_id', 'TEXT REFERENCES assets(id)');
  addColumn(db, 'assets', 'updated_at', 'TEXT');
  addColumn(db, 'character_references', 'asset_id', 'TEXT REFERENCES assets(id)');
  db.exec(`
    UPDATE assets SET uri = relative_path WHERE uri IS NULL;
    UPDATE assets SET status = 'approved' WHERE status IS NULL;
    UPDATE assets SET updated_at = created_at WHERE updated_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_assets_status
      ON assets(project_id, status, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_assets_replacement
      ON assets(replaces_asset_id);
    CREATE INDEX IF NOT EXISTS idx_character_references_asset
      ON character_references(asset_id);

    CREATE TABLE IF NOT EXISTS current_assets_manifests (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      manifest_version INTEGER NOT NULL CHECK (manifest_version > 0),
      created_at TEXT NOT NULL,
      UNIQUE (project_id, manifest_version)
    );
    CREATE TABLE IF NOT EXISTS manifest_entries (
      manifest_id TEXT NOT NULL REFERENCES current_assets_manifests(id),
      asset_id TEXT NOT NULL REFERENCES assets(id),
      PRIMARY KEY (manifest_id, asset_id)
    );
    CREATE INDEX IF NOT EXISTS idx_manifests_project
      ON current_assets_manifests(project_id, manifest_version);
    CREATE INDEX IF NOT EXISTS idx_manifest_entries_asset
      ON manifest_entries(asset_id);
  `);
}
