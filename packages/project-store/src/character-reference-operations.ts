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
    validateDerivedFrom(db, projectId, characterId, input.derived_from);
    validateAssetReference(db, projectId, input.asset_id, input.kind);
    const id = randomUUID();
    const now = new Date().toISOString();
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
    const row = db.prepare(
      'SELECT * FROM character_references WHERE id = ? AND character_id = ?',
    ).get(input.reference_id, characterId);
    if (!row) throw new StoreError('CHARACTER_REFERENCE_NOT_FOUND',
      'Character reference does not exist', { reference_id: input.reference_id });
    const existing = mapCharacterReference(row);
    const source = input.derived_from === undefined
      ? existing.derived_from : input.derived_from;
    validateDerivedFrom(db, projectId, characterId, source, existing.id);
    const assetId = input.asset_id === undefined ? existing.asset_id : input.asset_id;
    const kind = input.kind ?? existing.kind;
    validateAssetReference(db, projectId, assetId, kind);
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE character_references SET asset_id = ?, uri = ?, kind = ?, content_hash = ?,
       derived_from = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
    ).run(assetId, input.uri ?? existing.uri, kind,
      input.content_hash === undefined ? existing.content_hash : input.content_hash,
      source, input.sort_order ?? existing.sort_order, now, existing.id);
    return mapCharacterReference(
      db.prepare('SELECT * FROM character_references WHERE id = ?').get(existing.id),
    );
  })();
}
