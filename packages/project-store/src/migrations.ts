import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { StoreError } from './errors.js';
import {
  backfillLegacyLeaseEvents,
  migrateContinuityContract,
} from './migration-v4.js';
import { migrateAssetProducers } from './migration-v5.js';
import { createCanvasNodes } from './migration-v6.js';
import { createCharacters } from './migration-v7.js';
import { addAssetLifecycle } from './migration-v8.js';
import { createModes } from './migration-v9.js';
import { createProductionContext } from './migration-v10.js';
import { addSemanticBindings } from './migration-v11.js';
import { addRepresentativeTakeGate } from './migration-v12.js';
import { backfillSemanticReferences } from './migration-v13.js';
import { applyTailMigrations } from './migration-tail.js';

const CURRENT_SCHEMA_VERSION = 24;

const MIGRATION_V1 = `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
    active_script_version_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (active_script_version_id) REFERENCES script_versions(id)
      DEFERRABLE INITIALLY DEFERRED
  );

  CREATE TABLE script_versions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    version INTEGER NOT NULL CHECK (version > 0),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'locked', 'superseded')),
    created_at TEXT NOT NULL,
    locked_at TEXT,
    UNIQUE (project_id, version)
  );

  CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
    name TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE shot_plans (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    script_version_id TEXT NOT NULL REFERENCES script_versions(id),
    ordinal INTEGER NOT NULL CHECK (ordinal > 0),
    title TEXT NOT NULL,
    scene_id TEXT NOT NULL,
    duration_seconds REAL NOT NULL,
    shot_size TEXT NOT NULL,
    camera_movement TEXT NOT NULL,
    action TEXT NOT NULL,
    dialogue TEXT NOT NULL,
    sound TEXT NOT NULL,
    prompt TEXT NOT NULL,
    continuity_mode TEXT NOT NULL
      CHECK (continuity_mode IN ('independent', 'visual_match', 'chained')),
    continuity_dependencies_json TEXT NOT NULL,
    costume_state_json TEXT NOT NULL,
    reference_bindings_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (project_id, ordinal)
  );

  CREATE TABLE h3_jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    shot_plan_id TEXT NOT NULL REFERENCES shot_plans(id),
    mode TEXT NOT NULL CHECK (mode IN ('t2v', 'i2v', 'fl2v', 'r2v', 'v2v', 'rv2v')),
    provider TEXT NOT NULL CHECK (provider IN ('local_comfyui', 'minimax_api')),
    model TEXT NOT NULL,
    prompt TEXT NOT NULL,
    duration_seconds REAL NOT NULL,
    seed INTEGER,
    steps INTEGER NOT NULL,
    input_bindings_json TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    attempt INTEGER NOT NULL CHECK (attempt >= 0),
    status TEXT NOT NULL CHECK (
      status IN ('draft', 'submitting', 'queued', 'running', 'completed',
                 'failed', 'canceled', 'timed_out')
    ),
    provider_job_id TEXT,
    output_asset_id TEXT REFERENCES assets(id),
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    lease_expires_at TEXT,
    heartbeat_at TEXT,
    UNIQUE (shot_plan_id, idempotency_key)
  );

  CREATE TABLE job_events (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES h3_jobs(id),
    from_status TEXT CHECK (
      from_status IS NULL OR from_status IN (
        'draft', 'submitting', 'queued', 'running', 'completed', 'failed',
        'canceled', 'timed_out'
      )
    ),
    to_status TEXT NOT NULL CHECK (
      to_status IN ('draft', 'submitting', 'queued', 'running', 'completed',
                    'failed', 'canceled', 'timed_out')
    ),
    error_code TEXT,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE shot_actuals (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    shot_plan_id TEXT NOT NULL REFERENCES shot_plans(id),
    job_id TEXT NOT NULL REFERENCES h3_jobs(id),
    output_asset_id TEXT NOT NULL REFERENCES assets(id),
    attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
    observed_description TEXT NOT NULL,
    deviation_notes TEXT NOT NULL,
    qc_verdict TEXT NOT NULL CHECK (qc_verdict IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL,
    reviewed_at TEXT,
    UNIQUE (shot_plan_id, attempt_number),
    UNIQUE (job_id)
  );

  CREATE INDEX idx_scripts_project ON script_versions(project_id, version);
  CREATE INDEX idx_assets_project ON assets(project_id, created_at);
  CREATE INDEX idx_shots_project ON shot_plans(project_id, ordinal);
  CREATE INDEX idx_jobs_shot ON h3_jobs(shot_plan_id, created_at);
  CREATE INDEX idx_actuals_shot ON shot_actuals(shot_plan_id, attempt_number);
  CREATE INDEX idx_events_job ON job_events(job_id, created_at);
`;

const MIGRATION_V2 = `
  ALTER TABLE assets ADD COLUMN derived_from_asset_id TEXT
    REFERENCES assets(id);
  ALTER TABLE assets ADD COLUMN derivation_kind TEXT
    CHECK (
      derivation_kind IS NULL OR
      derivation_kind IN ('first_frame', 'last_frame', 'frame_extract')
    );
  CREATE INDEX idx_assets_source ON assets(derived_from_asset_id, derivation_kind);
`;

const MIGRATION_V3 = `
  ALTER TABLE h3_jobs ADD COLUMN lease_token TEXT;
  CREATE INDEX idx_jobs_lease ON h3_jobs(status, lease_expires_at);
`;

function migrateLegacyActiveJobs(db: Database.Database): void {
  const jobs = db
    .prepare(
      `SELECT id, status, updated_at FROM h3_jobs
       WHERE status IN ('submitting', 'queued', 'running')`,
    )
    .all() as Array<{ id: string; status: string; updated_at: string }>;
  const update = db.prepare(
    `UPDATE h3_jobs
     SET status = 'timed_out', error_code = 'LEASE_MIGRATED',
         error_message = 'Active pre-lease-token job requires retry',
         completed_at = updated_at, lease_expires_at = NULL
     WHERE id = ? AND status = ?`,
  );
  const event = db.prepare(
    `INSERT INTO job_events
     (id, job_id, from_status, to_status, error_code, message, created_at)
     VALUES (?, ?, ?, 'timed_out', 'LEASE_MIGRATED', ?, ?)`,
  );
  for (const job of jobs) {
    if (update.run(job.id, job.status).changes !== 1) continue;
    event.run(
      randomUUID(),
      job.id,
      job.status,
      'Pre-lease active job requires retry',
      job.updated_at,
    );
  }
}

function recordSchemaVersion(db: Database.Database, version: number): void {
  db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
    .run(version, new Date().toISOString());
}

export function migrateDatabase(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);

    const appliedVersions = new Set(
      (db.prepare('SELECT version FROM schema_version').all() as Array<{
        version: number;
      }>).map(({ version }) => version),
    );
    const version = Math.max(0, ...appliedVersions);
    if (version > CURRENT_SCHEMA_VERSION) {
      throw new StoreError(
        'SCHEMA_VERSION_UNSUPPORTED',
        `Database schema ${version} is newer than ${CURRENT_SCHEMA_VERSION}`,
        { database_version: version, supported_version: CURRENT_SCHEMA_VERSION },
      );
    }
    if (!appliedVersions.has(1)) {
      db.exec(MIGRATION_V1);
      recordSchemaVersion(db, 1);
    }
    if (!appliedVersions.has(2)) {
      db.exec(MIGRATION_V2);
      recordSchemaVersion(db, 2);
    }
    if (!appliedVersions.has(3)) {
      db.exec(MIGRATION_V3);
      migrateLegacyActiveJobs(db);
      recordSchemaVersion(db, 3);
    }
    if (!appliedVersions.has(4)) {
      backfillLegacyLeaseEvents(db);
      migrateContinuityContract(db);
      recordSchemaVersion(db, 4);
    }
    if (!appliedVersions.has(5)) {
      migrateAssetProducers(db);
      recordSchemaVersion(db, 5);
    }
    if (!appliedVersions.has(6)) {
      createCanvasNodes(db);
      recordSchemaVersion(db, 6);
    }
    if (!appliedVersions.has(7)) {
      createCharacters(db);
      recordSchemaVersion(db, 7);
    }
    if (!appliedVersions.has(8)) {
      addAssetLifecycle(db);
      recordSchemaVersion(db, 8);
    }
    if (!appliedVersions.has(9)) {
      createModes(db);
      recordSchemaVersion(db, 9);
    }
    if (!appliedVersions.has(10)) {
      createProductionContext(db);
      recordSchemaVersion(db, 10);
    }
    if (!appliedVersions.has(11)) {
      addSemanticBindings(db);
      recordSchemaVersion(db, 11);
    }
    if (!appliedVersions.has(12)) {
      addRepresentativeTakeGate(db);
      recordSchemaVersion(db, 12);
    }
    if (!appliedVersions.has(13)) {
      backfillSemanticReferences(db);
      recordSchemaVersion(db, 13);
    }
    applyTailMigrations(db, appliedVersions);
  })();
}
