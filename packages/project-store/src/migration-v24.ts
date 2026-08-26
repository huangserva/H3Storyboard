import type Database from 'better-sqlite3';

export function createScriptStudio(database: Database.Database): void {
  addColumn(database, 'script_versions', 'source_format', `TEXT NOT NULL
    DEFAULT 'legacy_text' CHECK (source_format IN ('legacy_text', 'plain_text',
      'shuohao_novel_script'))`);
  addColumn(database, 'script_versions', 'parent_version_id',
    'TEXT REFERENCES script_versions(id)');
  addColumn(database, 'script_versions', 'updated_at', 'TEXT');
  addColumn(database, 'script_versions', 'revision',
    'INTEGER NOT NULL DEFAULT 0');
  database.exec(`
    UPDATE script_versions SET updated_at = created_at WHERE updated_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_script_single_draft
      ON script_versions(project_id) WHERE status = 'draft';

    CREATE TABLE IF NOT EXISTS script_scenes (
      id TEXT PRIMARY KEY,
      script_version_id TEXT NOT NULL REFERENCES script_versions(id),
      ordinal INTEGER NOT NULL CHECK (ordinal > 0),
      scene_key TEXT NOT NULL,
      heading TEXT NOT NULL,
      location TEXT NOT NULL,
      time_of_day TEXT NOT NULL,
      lighting TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (script_version_id, ordinal),
      UNIQUE (script_version_id, scene_key)
    );

    CREATE TABLE IF NOT EXISTS script_beats (
      id TEXT PRIMARY KEY,
      script_scene_id TEXT NOT NULL REFERENCES script_scenes(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal > 0),
      kind TEXT NOT NULL CHECK (kind IN ('action', 'dialogue')),
      text TEXT NOT NULL,
      speaker TEXT,
      delivery TEXT,
      duration_seconds REAL NOT NULL CHECK (duration_seconds > 0),
      character_refs_json TEXT NOT NULL,
      costume_state_json TEXT NOT NULL,
      position_state_json TEXT NOT NULL,
      prop_state_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (script_scene_id, ordinal)
    );

    CREATE TABLE IF NOT EXISTS script_compilations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      script_version_id TEXT NOT NULL REFERENCES script_versions(id),
      idempotency_key TEXT NOT NULL,
      shot_count INTEGER NOT NULL CHECK (shot_count >= 0),
      created_at TEXT NOT NULL,
      UNIQUE (script_version_id, idempotency_key)
    );
  `);
  addColumn(database, 'shot_plans', 'planning_status', `TEXT NOT NULL
    DEFAULT 'approved'
    CHECK (planning_status IN ('draft', 'approved', 'superseded'))`);
  addColumn(database, 'shot_plans', 'source_script_scene_id',
    'TEXT REFERENCES script_scenes(id)');
  addColumn(database, 'shot_plans', 'source_script_beat_ids_json',
    `TEXT NOT NULL DEFAULT '[]'`);
  addColumn(database, 'shot_plans', 'source_compilation_id',
    'TEXT REFERENCES script_compilations(id)');
  addColumn(database, 'shot_plans', 'position_state_json',
    `TEXT NOT NULL DEFAULT '{}'`);
  addColumn(database, 'shot_plans', 'prop_state_json',
    `TEXT NOT NULL DEFAULT '{}'`);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_script_scenes_version
      ON script_scenes(script_version_id, ordinal);
    CREATE INDEX IF NOT EXISTS idx_script_beats_scene
      ON script_beats(script_scene_id, ordinal);
    CREATE INDEX IF NOT EXISTS idx_script_compilations_version
      ON script_compilations(script_version_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_script_single_compilation
      ON script_compilations(script_version_id);
    CREATE INDEX IF NOT EXISTS idx_shot_plans_compilation
      ON shot_plans(source_compilation_id, ordinal);
  `);
}

function addColumn(database: Database.Database, table: string, column: string,
  declaration: string): void {
  const columns = database.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (columns.some(({ name }) => name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
}
