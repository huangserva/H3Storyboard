import {
  AssetBindingSchema,
  ContinuityDependencySchema,
  H3ModeSchema,
  validateH3Bindings,
  validateH3BindingList,
  type AssetBinding,
  type AssetKind,
  type AssetRole,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { StoreError } from './errors.js';

interface ShotRow {
  id: string;
  continuity_dependencies_json: string;
  reference_bindings_json: string;
}

const allowedRoles: Readonly<Record<AssetKind, readonly AssetRole[]>> = {
  image: ['first_frame', 'last_frame', 'character', 'product', 'scene', 'style'],
  video: ['motion'],
  audio: ['audio'],
};

const migrationRole: Readonly<Record<AssetKind, AssetRole>> = {
  image: 'scene',
  video: 'motion',
  audio: 'audio',
};

export function migrateContinuityContract(db: Database.Database): void {
  const shots = db
    .prepare(
      `SELECT id, continuity_dependencies_json, reference_bindings_json
       FROM shot_plans`,
    )
    .all() as ShotRow[];
  const findTake = db.prepare(
    `SELECT output_asset_id FROM shot_actuals WHERE id = ?`,
  );
  const findAsset = db.prepare('SELECT kind FROM assets WHERE id = ?');
  const update = db.prepare(
    `UPDATE shot_plans
     SET continuity_dependencies_json = ?, reference_bindings_json = ?
     WHERE id = ?`,
  );

  for (const shot of shots) {
    const rawDependencies = parseArray(
      shot.continuity_dependencies_json,
      shot.id,
      'continuity_dependencies_json',
    );
    const rawBindings = parseArray(
      shot.reference_bindings_json,
      shot.id,
      'reference_bindings_json',
    );
    let migratedLegacyDependency = false;
    const dependencies = rawDependencies.map((value) => {
      const dependency = objectValue(value, shot.id, 'continuity dependency');
      if (!('source_asset_id' in dependency)) return dependency;

      const takeId = dependency.source_take_id;
      const take = typeof takeId === 'string'
        ? findTake.get(takeId) as { output_asset_id: string } | undefined
        : undefined;
      if (
        !take ||
        typeof dependency.source_asset_id !== 'string' ||
        dependency.source_asset_id !== take.output_asset_id
      ) {
        throw invalidMigration(
          shot.id,
          'Legacy continuity source must match its take output',
        );
      }
      const migrated = { ...dependency };
      delete migrated.source_asset_id;
      migrated.reference_asset_id = take.output_asset_id;
      migrated.boundary = 'full_video';
      migratedLegacyDependency = true;
      return migrated;
    });

    const bindings = rawBindings.map((value, ordinal) =>
      normalizeBinding(value, ordinal, shot.id, findAsset),
    );
    for (const dependency of dependencies) {
      const assetId = dependency.reference_asset_id;
      if (
        typeof assetId === 'string' &&
        !bindings.some(({ asset_id }) => asset_id === assetId)
      ) {
        const asset = findAsset.get(assetId) as { kind: AssetKind } | undefined;
        if (!asset) throw invalidMigration(shot.id, 'Continuity asset is missing');
        bindings.push({
          asset_id: assetId,
          asset_kind: asset.kind,
          role: migrationRole[asset.kind],
          ordinal: bindings.length,
        });
      }
    }

    const parsedDependencies = ContinuityDependencySchema.array().safeParse(
      dependencies,
    );
    const parsedBindings = AssetBindingSchema.array().safeParse(bindings);
    const bindingIssues = parsedBindings.success
      ? validateH3BindingList(parsedBindings.data)
      : [];
    if (
      !parsedDependencies.success ||
      !parsedBindings.success ||
      bindingIssues.length > 0
    ) {
      throw invalidMigration(shot.id, 'Migrated continuity contract is invalid');
    }
    if (migratedLegacyDependency) {
      auditLegacyJobs(
        db,
        shot.id,
        parsedDependencies.data.map(({ reference_asset_id }) =>
          reference_asset_id,
        ),
        parsedBindings.data,
      );
    }
    update.run(
      JSON.stringify(parsedDependencies.data),
      JSON.stringify(parsedBindings.data),
      shot.id,
    );
  }
}

function auditLegacyJobs(
  db: Database.Database,
  shotId: string,
  requiredAssetIds: string[],
  plannedBindings: AssetBinding[],
): void {
  const jobs = db
    .prepare(
      `SELECT id, mode, input_bindings_json FROM h3_jobs
       WHERE shot_plan_id = ?`,
    )
    .all(shotId) as Array<{
      id: string;
      mode: string;
      input_bindings_json: string;
    }>;
  const requiredBindings = plannedBindings.filter(({ asset_id }) =>
    requiredAssetIds.includes(asset_id),
  );
  for (const job of jobs) {
    const mode = H3ModeSchema.safeParse(job.mode);
    const bindings = AssetBindingSchema.array().safeParse(
      parseArray(job.input_bindings_json, shotId, 'input_bindings_json'),
    );
    const includesContinuity = bindings.success && requiredBindings.every(
      (planned) => bindings.data.some(
        (submitted) =>
          submitted.asset_id === planned.asset_id &&
          submitted.asset_kind === planned.asset_kind &&
          submitted.role === planned.role &&
          submitted.ordinal === planned.ordinal,
      ),
    );
    if (
      !mode.success ||
      !bindings.success ||
      !includesContinuity ||
      validateH3Bindings(mode.data, bindings.data).length > 0
    ) {
      throw new StoreError(
        'DATABASE_RECORD_INVALID',
        'Legacy H3 job cannot be truthfully upgraded to the continuity contract',
        { shot_plan_id: shotId, h3_job_id: job.id },
      );
    }
  }
}

export function backfillLegacyLeaseEvents(db: Database.Database): void {
  const jobs = db
    .prepare(
      `SELECT id, updated_at, completed_at FROM h3_jobs
       WHERE status = 'timed_out' AND error_code = 'LEASE_MIGRATED'
         AND NOT EXISTS (
           SELECT 1 FROM job_events
           WHERE job_events.job_id = h3_jobs.id
             AND job_events.to_status = 'timed_out'
             AND job_events.error_code = 'LEASE_MIGRATED'
         )`,
    )
    .all() as Array<{
      id: string;
      updated_at: string;
      completed_at: string | null;
    }>;
  const lastEvent = db.prepare(
    `SELECT to_status FROM job_events WHERE job_id = ?
     ORDER BY rowid DESC LIMIT 1`,
  );
  const insert = db.prepare(
    `INSERT INTO job_events
     (id, job_id, from_status, to_status, error_code, message, created_at)
     VALUES (?, ?, ?, 'timed_out', 'LEASE_MIGRATED', ?, ?)`,
  );
  for (const job of jobs) {
    const previous = lastEvent.get(job.id) as { to_status: string } | undefined;
    const fromStatus = ['submitting', 'queued', 'running'].includes(
      previous?.to_status ?? '',
    )
      ? previous!.to_status
      : null;
    insert.run(
      randomUUID(),
      job.id,
      fromStatus,
      'Pre-lease active job requires retry',
      job.completed_at ?? job.updated_at,
    );
  }
}

function normalizeBinding(
  value: unknown,
  ordinal: number,
  shotId: string,
  findAsset: Database.Statement,
): AssetBinding {
  const binding = objectValue(value, shotId, 'reference binding');
  const assetId = binding.asset_id;
  const asset = typeof assetId === 'string'
    ? findAsset.get(assetId) as { kind: AssetKind } | undefined
    : undefined;
  if (!asset) throw invalidMigration(shotId, 'Reference binding asset is missing');
  const role = typeof binding.role === 'string' &&
    allowedRoles[asset.kind].includes(binding.role as AssetRole)
    ? binding.role as AssetRole
    : migrationRole[asset.kind];
  return {
    asset_id: assetId as string,
    asset_kind: asset.kind,
    role,
    ordinal,
  };
}

function parseArray(value: string, shotId: string, column: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // The stable migration error below carries the record and column.
  }
  throw invalidMigration(shotId, `${column} must contain a JSON array`);
}

function objectValue(
  value: unknown,
  shotId: string,
  label: string,
): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw invalidMigration(shotId, `${label} must be an object`);
}

function invalidMigration(shotId: string, message: string): StoreError {
  return new StoreError('DATABASE_RECORD_INVALID', message, {
    shot_plan_id: shotId,
  });
}
