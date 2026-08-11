import {
  CreateCharacterInputSchema,
  UpdateCharacterInputSchema,
  type Character,
  type CreateCharacterInput,
  type UpdateCharacterInput,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { StoreError } from './errors.js';
import { parseInput } from './input.js';
import { mapCharacter } from './row-mappers.js';

function requireProject(db: Database.Database, projectId: string): void {
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) {
    throw new StoreError('PROJECT_NOT_FOUND', 'Project does not exist', {
      project_id: projectId,
    });
  }
}

export function listCharacters(
  db: Database.Database,
  projectId: string,
): Character[] {
  return db.transaction(() => {
    requireProject(db, projectId);
    return db.prepare(
      `SELECT * FROM characters WHERE project_id = ?
       ORDER BY created_at, id`,
    ).all(projectId).map(mapCharacter);
  })();
}

export function createCharacter(
  db: Database.Database,
  projectId: string,
  rawInput: CreateCharacterInput,
): Character {
  const input = parseInput(CreateCharacterInputSchema, rawInput);
  return db.transaction(() => {
    requireProject(db, projectId);
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO characters
       (id, project_id, name, canonical_appearance, seed_family_json, status,
        created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, projectId, input.name, input.canonical_appearance,
      JSON.stringify(input.seed_family), input.status, now, now);
    return mapCharacter(
      db.prepare('SELECT * FROM characters WHERE id = ?').get(id),
    );
  })();
}

export function updateCharacter(
  db: Database.Database,
  projectId: string,
  rawInput: UpdateCharacterInput,
): Character {
  const input = parseInput(UpdateCharacterInputSchema, rawInput);
  return db.transaction(() => {
    requireProject(db, projectId);
    const row = db.prepare(
      'SELECT * FROM characters WHERE id = ? AND project_id = ?',
    ).get(input.character_id, projectId);
    if (!row) throw new StoreError('CHARACTER_NOT_FOUND', 'Character does not exist', {
      project_id: projectId, character_id: input.character_id,
    });
    const existing = mapCharacter(row);
    if (existing.status === 'archived') {
      throw new StoreError('CHARACTER_ARCHIVED', 'Archived character is immutable', {
        character_id: existing.id,
      });
    }
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE characters SET name = ?, canonical_appearance = ?,
       seed_family_json = ?, status = ?, updated_at = ?
       WHERE id = ? AND project_id = ?`,
    ).run(input.name ?? existing.name,
      input.canonical_appearance ?? existing.canonical_appearance,
      JSON.stringify(input.seed_family ?? existing.seed_family),
      input.status ?? existing.status, now, existing.id, projectId);
    return mapCharacter(
      db.prepare('SELECT * FROM characters WHERE id = ?').get(existing.id),
    );
  })();
}
