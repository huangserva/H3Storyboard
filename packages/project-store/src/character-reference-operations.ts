import {
  CreateCharacterReferenceInputSchema,
  UpdateCharacterReferenceInputSchema,
  type CharacterReference,
  type CreateCharacterReferenceInput,
  type UpdateCharacterReferenceInput,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { StoreError } from './errors.js';
import { parseInput } from './input.js';
import { mapCharacterReference } from './row-mappers.js';
import { requireGenerationUnlocked, requireProject } from './generation-locks.js';

export function listProjectCharacterReferences(
  db: Database.Database,
  projectId: string,
): CharacterReference[] {
  return db.transaction(() => {
    requireProject(db, projectId);
    return db.prepare(
      `SELECT r.* FROM character_references r
       JOIN characters c ON c.id = r.character_id
       WHERE c.project_id = ?
       ORDER BY c.created_at, c.id, r.sort_order, r.created_at, r.id`,
    ).all(projectId).map(mapCharacterReference);
  })();
}

function requireCharacter(
  db: Database.Database,
  projectId: string,
  characterId: string,
): void {
  const row = db.prepare('SELECT project_id FROM characters WHERE id = ?')
    .get(characterId) as { project_id: string } | undefined;
  if (!row) throw new StoreError('CHARACTER_NOT_FOUND', 'Character does not exist', {
    character_id: characterId,
  });
  if (row.project_id !== projectId) {
    throw new StoreError('CHARACTER_NOT_FOUND', 'Character does not exist', {
      project_id: projectId, character_id: characterId,
    });
  }
}

function validateDerivedFrom(
  db: Database.Database,
  projectId: string,
  characterId: string,
  sourceId: string | null,
  referenceId?: string,
): void {
  let cursor = sourceId;
  while (cursor !== null) {
    if (cursor === referenceId) {
      throw new StoreError('CHARACTER_REFERENCE_DERIVATION_INVALID',
        'Character reference lineage cannot contain a cycle', { reference_id: cursor });
    }
    const source = db.prepare(
      `SELECT r.character_id, r.derived_from, c.project_id
       FROM character_references r JOIN characters c ON c.id = r.character_id
       WHERE r.id = ?`,
    ).get(cursor) as { character_id: string; derived_from: string | null;
      project_id: string } | undefined;
    if (!source) throw new StoreError('CHARACTER_REFERENCE_NOT_FOUND',
      'Derived-from character reference does not exist', { reference_id: cursor });
    if (source.project_id !== projectId) {
      throw new StoreError('CHARACTER_REFERENCE_PROJECT_MISMATCH',
        'Derived-from reference belongs to another project', { reference_id: cursor });
    }
    if (source.character_id !== characterId) {
      throw new StoreError('CHARACTER_REFERENCE_DERIVATION_INVALID',
        'Derived references must belong to the same character', { reference_id: cursor });
    }
    cursor = source.derived_from;
  }
}

function validateAssetReference(db: Database.Database, projectId: string,
  assetId: string | null, kind: string): void {
  if (assetId === null) return;
  const asset = db.prepare('SELECT project_id, kind FROM assets WHERE id = ?')
    .get(assetId) as { project_id: string; kind: string } | undefined;
  if (!asset) throw new StoreError('ASSET_NOT_FOUND', 'Asset does not exist', {
    asset_id: assetId,
  });
  if (asset.project_id !== projectId) throw new StoreError(
    'ASSET_PROJECT_MISMATCH', 'Asset belongs to another project', {
      project_id: projectId, asset_id: assetId,
    });
  if (asset.kind !== kind) throw new StoreError('ASSET_KIND_MISMATCH',
    'Character reference kind must match its asset', { asset_id: assetId });
}

export function listCharacterReferences(db: Database.Database, projectId: string,
  characterId: string): CharacterReference[] {
  return db.transaction(() => {
    requireCharacter(db, projectId, characterId);
    return db.prepare(
      `SELECT * FROM character_references WHERE character_id = ?
       ORDER BY sort_order, created_at, id`,
    ).all(characterId).map(mapCharacterReference);
  })();
}

export function createCharacterReference(db: Database.Database, projectId: string,
  characterId: string, rawInput: CreateCharacterReferenceInput): CharacterReference {
  const input = parseInput(CreateCharacterReferenceInputSchema, rawInput);
  return db.transaction(() => {
    requireCharacter(db, projectId, characterId);
    requireGenerationUnlocked(db, projectId);
    if (input.derived_from !== null && input.sort_order === 0) {
      throw new StoreError('CHARACTER_REFERENCE_DERIVATION_INVALID',
        'Derived angle references cannot occupy the primary mother-image slot');
    }
    validateDerivedFrom(db, projectId, characterId, input.derived_from);
    validateAssetReference(db, projectId, input.asset_id, input.kind);
    const id = randomUUID();
    const now = new Date().toISOString();
    if (input.derived_from === null && input.sort_order === 0) {
      db.prepare(
        `UPDATE character_references
         SET sort_order = sort_order + 1, updated_at = ?
         WHERE character_id = ?`,
      ).run(now, characterId);
    }
    db.prepare(
      `INSERT INTO character_references
       (id, character_id, asset_id, uri, kind, content_hash, derived_from,
        sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, characterId, input.asset_id, input.uri, input.kind,
      input.content_hash, input.derived_from, input.sort_order, now, now);
    return mapCharacterReference(
      db.prepare('SELECT * FROM character_references WHERE id = ?').get(id),
    );
  })();
}

export function updateCharacterReference(db: Database.Database, projectId: string,
  characterId: string, rawInput: UpdateCharacterReferenceInput): CharacterReference {
  const input = parseInput(UpdateCharacterReferenceInputSchema, rawInput);
  return db.transaction(() => {
    requireCharacter(db, projectId, characterId);
    requireGenerationUnlocked(db, projectId);
    const row = db.prepare(
      'SELECT * FROM character_references WHERE id = ? AND character_id = ?',
    ).get(input.reference_id, characterId);
    if (!row) throw new StoreError('CHARACTER_REFERENCE_NOT_FOUND',
      'Character reference does not exist', { reference_id: input.reference_id });
    const existing = mapCharacterReference(row);
    const uploadManaged = Boolean(db.prepare(
      'SELECT 1 FROM character_reference_uploads WHERE reference_id = ?',
    ).get(existing.id));
    const imageJobManaged = Boolean(db.prepare(
      'SELECT 1 FROM character_image_jobs WHERE output_reference_id = ?',
    ).get(existing.id));
    if ((uploadManaged || imageJobManaged) &&
      changesUploadedReferenceContent(existing, input)) {
      throw new StoreError('CHARACTER_REFERENCE_IMMUTABLE',
        'Persisted reference content and lineage are immutable', {
          reference_id: existing.id,
        });
    }
    const source = input.derived_from === undefined
      ? existing.derived_from : input.derived_from;
    const sortOrder = input.sort_order ?? existing.sort_order;
    if (source !== null && sortOrder === 0) {
      throw new StoreError('CHARACTER_REFERENCE_DERIVATION_INVALID',
        'Derived angle references cannot occupy the primary mother-image slot', {
          reference_id: existing.id,
        });
    }
    validateDerivedFrom(db, projectId, characterId, source, existing.id);
    const assetId = input.asset_id === undefined ? existing.asset_id : input.asset_id;
    const kind = input.kind ?? existing.kind;
    validateAssetReference(db, projectId, assetId, kind);
    const now = new Date().toISOString();
    if (source === null && sortOrder === 0 && existing.sort_order !== 0) {
      db.prepare(
        `UPDATE character_references
         SET sort_order = sort_order + 1, updated_at = ?
         WHERE character_id = ? AND id <> ? AND sort_order < ?`,
      ).run(now, characterId, existing.id, existing.sort_order);
    }
    db.prepare(
      `UPDATE character_references SET asset_id = ?, uri = ?, kind = ?, content_hash = ?,
       derived_from = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
    ).run(assetId, input.uri ?? existing.uri, kind,
      input.content_hash === undefined ? existing.content_hash : input.content_hash,
      source, sortOrder, now, existing.id);
    return mapCharacterReference(
      db.prepare('SELECT * FROM character_references WHERE id = ?').get(existing.id),
    );
  })();
}

function changesUploadedReferenceContent(
  existing: CharacterReference,
  input: UpdateCharacterReferenceInput,
): boolean {
  return (input.asset_id !== undefined && input.asset_id !== existing.asset_id) ||
    (input.uri !== undefined && input.uri !== existing.uri) ||
    (input.kind !== undefined && input.kind !== existing.kind) ||
    (input.content_hash !== undefined &&
      input.content_hash !== existing.content_hash) ||
    (input.derived_from !== undefined &&
      input.derived_from !== existing.derived_from);
}
