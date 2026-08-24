import type {
  ApproveCharacterReferenceInput,
  ApproveCharacterReferenceResult,
  CharacterReferenceUploadResult,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { updateAsset } from './asset-operations.js';
import { StoreError } from './errors.js';
import { requireGenerationUnlocked } from './generation-locks.js';
import { mapAsset, mapCharacterReference } from './row-mappers.js';

export interface RegisterCharacterUploadInput {
  idempotency_key: string;
  request_hash: string;
  name: string;
  relative_path: string;
  content_hash: string;
  derived_from: string | null;
}

export class CharacterMediaStore {
  constructor(private readonly database: Database.Database) {}

  registerUpload(projectId: string, characterId: string,
    input: RegisterCharacterUploadInput): CharacterReferenceUploadResult {
    return this.database.transaction(() => {
      const character = requireCharacter(this.database, projectId, characterId);
      if (character.status === 'archived') throw new StoreError(
        'CHARACTER_ARCHIVED', 'Archived character is immutable', {
          character_id: characterId,
        });
      requireGenerationUnlocked(this.database, projectId);
      const receipt = this.database.prepare(
        `SELECT request_hash, asset_id, reference_id
         FROM character_reference_uploads
         WHERE project_id = ? AND character_id = ? AND idempotency_key = ?`,
      ).get(projectId, characterId, input.idempotency_key) as UploadReceipt | undefined;
      if (receipt) {
        if (receipt.request_hash !== input.request_hash) throw new StoreError(
          'CHARACTER_REFERENCE_UPLOAD_CONFLICT',
          'Idempotency key was already used for a different upload payload', {
            project_id: projectId, character_id: characterId,
            idempotency_key: input.idempotency_key,
          });
        return this.uploadResult(receipt.asset_id, receipt.reference_id, true);
      }
      const source = validateSource(
        this.database, projectId, characterId, input.derived_from);
      const assetId = randomUUID();
      const referenceId = randomUUID();
      const now = new Date().toISOString();
      const sortOrder = (this.database.prepare(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order
         FROM character_references WHERE character_id = ?`,
      ).get(characterId) as { next_sort_order: number }).next_sort_order;
      this.database.prepare(
        `INSERT INTO assets
         (id, project_id, kind, name, relative_path, uri, content_hash, status,
          replaces_asset_id, derived_from_asset_id, derivation_kind,
          created_at, updated_at)
         VALUES (?, ?, 'image', ?, ?, ?, ?, 'candidate', NULL, NULL, NULL, ?, ?)`,
      ).run(assetId, projectId, input.name, input.relative_path,
        input.relative_path, input.content_hash, now, now);
      this.database.prepare(
        `INSERT INTO character_references
         (id, character_id, asset_id, uri, kind, content_hash, derived_from,
          sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'image', ?, ?, ?, ?, ?)`,
      ).run(referenceId, characterId, assetId, input.relative_path,
        input.content_hash, input.derived_from, sortOrder, now, now);
      if (source) this.database.prepare(
        `INSERT INTO character_asset_derivations
         (asset_id, source_asset_id, kind, created_at)
         VALUES (?, ?, 'character_angle_upload', ?)`,
      ).run(assetId, source.asset_id, now);
      this.database.prepare(
        `INSERT INTO character_reference_uploads
         (project_id, character_id, idempotency_key, request_hash,
          asset_id, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(projectId, characterId, input.idempotency_key, input.request_hash,
        assetId, referenceId, now);
      return this.uploadResult(assetId, referenceId, false);
    }).immediate();
  }

  approveReference(projectId: string, characterId: string, referenceId: string,
    input: ApproveCharacterReferenceInput): ApproveCharacterReferenceResult {
    return this.database.transaction(() => {
      const character = requireCharacter(this.database, projectId, characterId);
      if (character.status === 'archived') throw new StoreError(
        'CHARACTER_ARCHIVED', 'Archived character is immutable', {
          character_id: characterId,
        });
      requireGenerationUnlocked(this.database, projectId);
      const row = this.database.prepare(
        `SELECT r.*, a.status AS asset_status
         FROM character_references r
         JOIN assets a ON a.id = r.asset_id
         WHERE r.id = ? AND r.character_id = ? AND a.project_id = ?
           AND r.kind = 'image' AND a.kind = 'image'`,
      ).get(referenceId, characterId, projectId) as
        (Record<string, unknown> & { asset_id: string; asset_status: string;
          derived_from: string | null; sort_order: number }) | undefined;
      if (!row) throw new StoreError('CHARACTER_REFERENCE_NOT_FOUND',
        'Image-backed character reference does not exist', {
          project_id: projectId, character_id: characterId,
          reference_id: referenceId,
        });
      if (row.asset_status === 'archived') throw new StoreError(
        'ASSET_ARCHIVED', 'Archived reference assets are immutable', {
          asset_id: row.asset_id,
        });
      if (row.derived_from !== null) {
        validateSource(this.database, projectId, characterId, row.derived_from);
      }
      if (row.derived_from !== null && input.make_primary !== false) {
        throw new StoreError('CHARACTER_REFERENCE_DERIVATION_INVALID',
          'Derived angle references cannot become the primary mother image', {
            reference_id: referenceId,
          });
      }
      const now = new Date().toISOString();
      if (input.make_primary !== false && row.sort_order !== 0) {
        this.database.prepare(
          `UPDATE character_references
           SET sort_order = sort_order + 1, updated_at = ?
           WHERE character_id = ? AND id <> ? AND sort_order < ?`,
        ).run(now, characterId, referenceId, row.sort_order);
        this.database.prepare(
          `UPDATE character_references SET sort_order = 0, updated_at = ?
           WHERE id = ?`,
        ).run(now, referenceId);
      }
      const approvedAsset = updateAsset(this.database, projectId, {
        asset_id: row.asset_id,
        status: 'approved',
      });
      const latestManifest = this.database.prepare(
        `SELECT id FROM current_assets_manifests WHERE project_id = ?
         ORDER BY manifest_version DESC LIMIT 1`,
      ).get(projectId) as { id: string } | undefined;
      const inManifest = latestManifest ? Boolean(this.database.prepare(
        `SELECT 1 FROM manifest_entries WHERE manifest_id = ? AND asset_id = ?`,
      ).get(latestManifest.id, row.asset_id)) : false;
      return {
        asset: approvedAsset,
        reference: mapCharacterReference(this.database.prepare(
          'SELECT * FROM character_references WHERE id = ?').get(referenceId)),
        manifest_stale: Boolean(latestManifest) && !inManifest,
      };
    }).immediate();
  }

  private uploadResult(assetId: string, referenceId: string,
    replayed: boolean): CharacterReferenceUploadResult {
    return {
      asset: mapAsset(this.database.prepare(
        'SELECT * FROM assets WHERE id = ?').get(assetId)),
      reference: mapCharacterReference(this.database.prepare(
        'SELECT * FROM character_references WHERE id = ?').get(referenceId)),
      asset_derivation: (this.database.prepare(
        `SELECT * FROM character_asset_derivations WHERE asset_id = ?`,
      ).get(assetId) ?? null) as CharacterReferenceUploadResult['asset_derivation'],
      replayed,
    };
  }
}

interface UploadReceipt {
  request_hash: string;
  asset_id: string;
  reference_id: string;
}

function requireCharacter(db: Database.Database, projectId: string,
  characterId: string): { status: string } {
  const row = db.prepare(
    'SELECT status FROM characters WHERE id = ? AND project_id = ?',
  ).get(characterId, projectId) as { status: string } | undefined;
  if (!row) throw new StoreError('CHARACTER_NOT_FOUND',
    'Character does not exist', { project_id: projectId,
      character_id: characterId });
  return row;
}

function validateSource(db: Database.Database, projectId: string,
  characterId: string, sourceId: string | null): { asset_id: string } | null {
  if (sourceId === null) return null;
  const source = db.prepare(
    `SELECT r.character_id, r.asset_id, r.derived_from, c.project_id,
            a.kind AS asset_kind, a.status AS asset_status
     FROM character_references r JOIN characters c ON c.id = r.character_id
     LEFT JOIN assets a ON a.id = r.asset_id WHERE r.id = ?`,
  ).get(sourceId) as { character_id: string; project_id: string;
    asset_id: string | null; asset_kind: string | null;
    asset_status: string | null; derived_from: string | null } | undefined;
  if (!source) throw new StoreError('CHARACTER_REFERENCE_NOT_FOUND',
    'Derived-from character reference does not exist', {
      reference_id: sourceId,
    });
  if (source.project_id !== projectId) throw new StoreError(
    'CHARACTER_REFERENCE_PROJECT_MISMATCH',
    'Derived-from reference belongs to another project', {
      reference_id: sourceId,
    });
  if (source.character_id !== characterId) throw new StoreError(
    'CHARACTER_REFERENCE_DERIVATION_INVALID',
    'Derived references must belong to the same character', {
      reference_id: sourceId,
    });
  if (source.asset_id === null || source.asset_kind !== 'image' ||
    source.asset_status !== 'approved') throw new StoreError(
    'CHARACTER_REFERENCE_DERIVATION_INVALID',
    'Derived uploads require an approved image-backed source reference', {
      reference_id: sourceId,
    });
  if (source.derived_from !== null) throw new StoreError(
    'CHARACTER_REFERENCE_DERIVATION_INVALID',
    'Angle uploads must derive from the approved root mother image', {
      reference_id: sourceId,
    });
  return { asset_id: source.asset_id };
}
