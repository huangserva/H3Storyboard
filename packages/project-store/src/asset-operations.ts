import {
  CreateAssetInputSchema,
  UpdateAssetInputSchema,
  type Asset,
  type CreateAssetInput,
  type UpdateAssetInput,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { StoreError } from './errors.js';
import { requireGenerationUnlocked } from './generation-locks.js';
import { parseInput } from './input.js';
import { mapAsset } from './row-mappers.js';

function requireProject(db: Database.Database, projectId: string): void {
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) {
    throw new StoreError('PROJECT_NOT_FOUND', 'Project does not exist', {
      project_id: projectId,
    });
  }
}

export function listAssets(db: Database.Database, projectId: string): Asset[] {
  return db.transaction(() => {
    requireProject(db, projectId);
    return db.prepare(
      'SELECT * FROM assets WHERE project_id = ? ORDER BY created_at, id',
    ).all(projectId).map(mapAsset);
  })();
}

function requireRelatedAsset(db: Database.Database, projectId: string, assetId: string) {
  const asset = db.prepare('SELECT project_id, kind, status FROM assets WHERE id = ?')
    .get(assetId) as { project_id: string; kind: string; status: string } | undefined;
  if (!asset) throw new StoreError('ASSET_NOT_FOUND', 'Asset does not exist', {
    asset_id: assetId,
  });
  if (asset.project_id !== projectId) throw new StoreError(
    'ASSET_PROJECT_MISMATCH', 'Asset belongs to another project', {
      project_id: projectId, asset_id: assetId,
    });
  return asset;
}

export function createAsset(db: Database.Database, projectId: string,
  rawInput: CreateAssetInput): Asset {
  const input = parseInput(CreateAssetInputSchema, rawInput);
  return db.transaction(() => {
    requireProject(db, projectId);
    if (input.replaces_asset_id !== null) {
      requireGenerationUnlocked(db, projectId);
    }
    if (input.derived_from_asset_id !== null) {
      const source = requireRelatedAsset(db, projectId, input.derived_from_asset_id);
      if (source.kind !== 'video') throw new StoreError('ASSET_DERIVATION_INVALID',
        'Boundary frames must be derived from a video asset', {
          asset_id: input.derived_from_asset_id, asset_kind: source.kind,
        });
    }
    if (input.replaces_asset_id !== null) {
      const source = requireRelatedAsset(db, projectId, input.replaces_asset_id);
      if (source.status !== 'approved' || source.kind !== input.kind) {
        throw new StoreError('ASSET_REPLACEMENT_INVALID',
          'Replacement source must be approved and have the same kind', {
            asset_id: input.replaces_asset_id,
          });
      }
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const uri = input.uri ?? input.relative_path!;
    const relativePath = input.relative_path ?? uri;
    const name = input.name ?? uri.split(/[\\/]/).filter(Boolean).at(-1) ?? 'asset';
    db.prepare(
      `INSERT INTO assets
       (id, project_id, kind, name, relative_path, uri, content_hash, status,
        replaces_asset_id, derived_from_asset_id, derivation_kind,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, projectId, input.kind, name, relativePath, uri,
      input.content_hash ?? '', input.status, input.replaces_asset_id,
      input.derived_from_asset_id, input.derivation_kind, now, now);
    return mapAsset(db.prepare('SELECT * FROM assets WHERE id = ?').get(id));
  })();
}

export function updateAsset(db: Database.Database, projectId: string,
  rawInput: UpdateAssetInput): Asset {
  const input = parseInput(UpdateAssetInputSchema, rawInput);
  return db.transaction(() => {
    requireProject(db, projectId);
    const row = db.prepare('SELECT * FROM assets WHERE id = ? AND project_id = ?')
      .get(input.asset_id, projectId);
    if (!row) throw new StoreError('ASSET_NOT_FOUND', 'Asset does not exist', {
      project_id: projectId, asset_id: input.asset_id,
    });
    const existing = mapAsset(row);
    if (input.status !== undefined && input.status !== existing.status) {
      requireGenerationUnlocked(db, projectId);
    }
    if (existing.status === 'archived') throw new StoreError(
      'ASSET_ARCHIVED', 'Archived asset is immutable', { asset_id: existing.id });
    if ((input.uri !== undefined || input.content_hash !== undefined) &&
      existing.status !== 'candidate') {
      throw new StoreError('ASSET_IMMUTABLE', 'Approved asset content is immutable', {
        asset_id: existing.id,
      });
    }
    const nextStatus = input.status ?? existing.status;
    if (existing.status === 'approved' && nextStatus === 'candidate') {
      throw new StoreError('ASSET_STATUS_INVALID',
        'Approved asset cannot return to candidate', { asset_id: existing.id });
    }
    const uri = input.uri ?? existing.uri;
    const hash = input.content_hash === undefined
      ? existing.content_hash : input.content_hash;
    const now = new Date().toISOString();
    if (existing.status === 'candidate' && nextStatus === 'approved' &&
      existing.replaces_asset_id !== null) {
      const source = requireRelatedAsset(db, projectId, existing.replaces_asset_id);
      if (source.status !== 'approved' || source.kind !== existing.kind) {
        throw new StoreError('ASSET_REPLACEMENT_INVALID',
          'Replacement source must still be approved when its replacement is approved',
          { asset_id: existing.replaces_asset_id });
      }
      db.prepare(`UPDATE assets SET status = 'archived', updated_at = ?
        WHERE id = ? AND status = 'approved'`).run(now, existing.replaces_asset_id);
    }
    db.prepare(
      `UPDATE assets SET uri = ?, relative_path = ?, content_hash = ?,
       status = ?, updated_at = ? WHERE id = ? AND project_id = ?`,
    ).run(uri, input.uri === undefined ? existing.relative_path : uri,
      hash ?? '', nextStatus, now, existing.id, projectId);
    return mapAsset(db.prepare('SELECT * FROM assets WHERE id = ?').get(existing.id));
  })();
}
