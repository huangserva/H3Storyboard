import {
  CurrentAssetsManifestSchema,
  CurrentAssetsManifestSnapshotSchema,
  ManifestEntrySchema,
  type CurrentAssetsManifestSnapshot,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { StoreError } from './errors.js';
import { parseInput } from './input.js';

function requireProject(db: Database.Database, projectId: string): void {
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) {
    throw new StoreError('PROJECT_NOT_FOUND', 'Project does not exist', {
      project_id: projectId,
    });
  }
}

function mapSnapshot(db: Database.Database, row: unknown) {
  const manifest = parseInput(CurrentAssetsManifestSchema, row,
    'DATABASE_RECORD_INVALID');
  const entries = db.prepare(
    'SELECT manifest_id, asset_id FROM manifest_entries WHERE manifest_id = ? ORDER BY asset_id',
  ).all(manifest.id).map((entry) => parseInput(
    ManifestEntrySchema, entry, 'DATABASE_RECORD_INVALID'));
  return parseInput(CurrentAssetsManifestSnapshotSchema, { manifest, entries },
    'DATABASE_RECORD_INVALID');
}

export function freezeCurrentAssetsManifest(db: Database.Database,
  projectId: string): CurrentAssetsManifestSnapshot {
  return db.transaction(() => {
    requireProject(db, projectId);
    const assets = db.prepare(
      `SELECT id FROM assets WHERE project_id = ? AND status = 'approved'
       ORDER BY id`,
    ).all(projectId) as Array<{ id: string }>;
    if (assets.length === 0) throw new StoreError('MANIFEST_EMPTY',
      'Cannot freeze a manifest without approved assets', { project_id: projectId });
    const latest = db.prepare(
      'SELECT MAX(manifest_version) AS version FROM current_assets_manifests WHERE project_id = ?',
    ).get(projectId) as { version: number | null };
    const id = randomUUID();
    const version = (latest.version ?? 0) + 1;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO current_assets_manifests
       (id, project_id, manifest_version, created_at) VALUES (?, ?, ?, ?)`,
    ).run(id, projectId, version, now);
    const insert = db.prepare(
      'INSERT INTO manifest_entries (manifest_id, asset_id) VALUES (?, ?)',
    );
    for (const asset of assets) insert.run(id, asset.id);
    return mapSnapshot(db, db.prepare(
      'SELECT * FROM current_assets_manifests WHERE id = ?',
    ).get(id));
  })();
}

export function listCurrentAssetsManifests(db: Database.Database,
  projectId: string): CurrentAssetsManifestSnapshot[] {
  return db.transaction(() => {
    requireProject(db, projectId);
    return db.prepare(
      `SELECT * FROM current_assets_manifests WHERE project_id = ?
       ORDER BY manifest_version`,
    ).all(projectId).map((row) => mapSnapshot(db, row));
  })();
}

export function getCurrentAssetsManifest(db: Database.Database,
  projectId: string, version: number): CurrentAssetsManifestSnapshot {
  return db.transaction(() => {
    requireProject(db, projectId);
    const row = db.prepare(
      `SELECT * FROM current_assets_manifests
       WHERE project_id = ? AND manifest_version = ?`,
    ).get(projectId, version);
    if (!row) throw new StoreError('MANIFEST_NOT_FOUND', 'Manifest does not exist', {
      project_id: projectId, manifest_version: version,
    });
    return mapSnapshot(db, row);
  })();
}
