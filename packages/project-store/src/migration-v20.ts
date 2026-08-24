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

export function createCharacterImageJobsAndGpuLeases(
  db: Database.Database,
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_image_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      character_id TEXT NOT NULL REFERENCES characters(id),
      retry_of_job_id TEXT REFERENCES character_image_jobs(id),
      operation TEXT NOT NULL CHECK (
        operation IN ('master_t2i', 'identity_edit', 'variant_i2i')
      ),
      provider TEXT NOT NULL CHECK (provider = 'local_comfyui'),
      engine TEXT NOT NULL CHECK (
        engine IN ('krea2', 'qwen_image_edit_2511')
      ),
      prompt TEXT NOT NULL,
      seed INTEGER NOT NULL CHECK (seed >= 0),
      width INTEGER NOT NULL CHECK (width >= 64 AND width <= 4096 AND width % 8 = 0),
      height INTEGER NOT NULL CHECK (height >= 64 AND height <= 4096 AND height % 8 = 0),
      steps INTEGER NOT NULL CHECK (steps >= 1 AND steps <= 100),
      cfg REAL NOT NULL CHECK (cfg > 0 AND cfg <= 30),
      sampler TEXT NOT NULL,
      scheduler TEXT NOT NULL,
      denoise REAL CHECK (denoise IS NULL OR (denoise >= 0 AND denoise <= 1)),
      lora_profile TEXT,
      lora_name TEXT,
      lora_strength REAL,
      source_inputs_json TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('draft', 'submitting', 'queued', 'running', 'completed',
                   'failed', 'canceled', 'timed_out')
      ),
      attempt INTEGER NOT NULL CHECK (attempt >= 0),
      provider_client_id TEXT,
      provider_job_id TEXT,
      output_asset_id TEXT REFERENCES assets(id),
      output_reference_id TEXT REFERENCES character_references(id),
      error_code TEXT,
      error_message TEXT,
      cancel_reason TEXT,
      lease_token TEXT,
      lease_expires_at TEXT,
      heartbeat_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE (character_id, idempotency_key),
      CHECK (
        (operation = 'identity_edit' AND engine = 'qwen_image_edit_2511') OR
        (operation IN ('master_t2i', 'variant_i2i') AND engine = 'krea2')
      ),
      CHECK (
        (operation = 'master_t2i' AND denoise IS NULL) OR
        (operation IN ('identity_edit', 'variant_i2i') AND denoise IS NOT NULL)
      ),
      CHECK (
        (lora_profile IS NULL AND lora_name IS NULL AND lora_strength IS NULL) OR
        (lora_profile IS NOT NULL AND lora_name IS NOT NULL AND lora_strength IS NOT NULL)
      )
    );

    CREATE TABLE IF NOT EXISTS character_image_job_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES character_image_jobs(id),
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

    CREATE TABLE IF NOT EXISTS gpu_leases (
      gpu_host TEXT PRIMARY KEY,
      owner_kind TEXT NOT NULL CHECK (
        owner_kind IN ('h3_video', 'character_image')
      ),
      owner_job_id TEXT NOT NULL,
      lease_token TEXT NOT NULL UNIQUE,
      lease_expires_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_character_image_jobs_character
      ON character_image_jobs(character_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_character_image_jobs_claim
      ON character_image_jobs(provider, status, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_character_image_jobs_lease
      ON character_image_jobs(status, lease_expires_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_character_image_jobs_provider_client
      ON character_image_jobs(provider_client_id)
      WHERE provider_client_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_character_image_jobs_provider_job
      ON character_image_jobs(provider_job_id)
      WHERE provider_job_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_character_image_jobs_output_asset
      ON character_image_jobs(output_asset_id)
      WHERE output_asset_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_character_image_jobs_output_reference
      ON character_image_jobs(output_reference_id)
      WHERE output_reference_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_character_image_job_events_job
      ON character_image_job_events(job_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_gpu_leases_expiry
      ON gpu_leases(lease_expires_at, gpu_host);
  `);
  addColumn(
    db,
    'character_image_jobs',
    'retry_of_job_id',
    'TEXT REFERENCES character_image_jobs(id)',
  );
  addColumn(
    db,
    'assets',
    'producer_image_job_id',
    'TEXT REFERENCES character_image_jobs(id)',
  );
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_character_image_jobs_retry
      ON character_image_jobs(retry_of_job_id, created_at, id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_producer_image_job
      ON assets(producer_image_job_id)
      WHERE producer_image_job_id IS NOT NULL;
  `);
}
