import {
  CreateModeInputSchema,
  UpdateModeInputSchema,
  type CreateModeInput,
  type Mode,
  type ModeValidationStatus,
  type UpdateModeInput,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { StoreError } from './errors.js';
import { parseInput } from './input.js';
import { mapMode } from './row-mappers.js';
import { requireAllGenerationUnlocked } from './generation-locks.js';

const transitions: Readonly<Record<ModeValidationStatus, ModeValidationStatus>> = {
  candidate: 'validated',
  validated: 'blocked',
  blocked: 'candidate',
};

export function listModes(db: Database.Database): Mode[] {
  return db.prepare('SELECT * FROM modes ORDER BY key').all().map(mapMode);
}

export function createMode(db: Database.Database, rawInput: CreateModeInput): Mode {
  const input = parseInput(CreateModeInputSchema, rawInput);
  return db.transaction(() => {
    if (db.prepare('SELECT id FROM modes WHERE key = ?').get(input.key)) {
      throw new StoreError('MODE_KEY_CONFLICT', 'Mode key already exists', {
        key: input.key,
      });
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO modes
       (id, key, title, description, capability_declaration_json,
        validation_status, evidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'candidate', NULL, ?, ?)`,
    ).run(id, input.key, input.title, input.description,
      JSON.stringify(input.capability_declaration), now, now);
    return mapMode(db.prepare('SELECT * FROM modes WHERE id = ?').get(id));
  })();
}

export function updateMode(db: Database.Database, rawInput: UpdateModeInput): Mode {
  const input = parseInput(UpdateModeInputSchema, rawInput);
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM modes WHERE id = ?').get(input.mode_id);
    if (!row) throw new StoreError('MODE_NOT_FOUND', 'Mode does not exist', {
      mode_id: input.mode_id,
    });
    const existing = mapMode(row);
    if (input.capability_declaration !== undefined) {
      requireAllGenerationUnlocked(db);
    }
    const nextStatus = input.validation_status ?? existing.validation_status;
    const changingStatus = nextStatus !== existing.validation_status;
    if (changingStatus && transitions[existing.validation_status] !== nextStatus) {
      throw new StoreError('MODE_TRANSITION_INVALID',
        'Mode validation status cannot skip its required next state', {
          from_status: existing.validation_status, to_status: nextStatus,
        });
    }
    if (changingStatus && nextStatus !== 'candidate' && input.evidence == null) {
      throw new StoreError('MODE_EVIDENCE_REQUIRED',
        'This mode status transition requires evidence', {
          from_status: existing.validation_status, to_status: nextStatus,
        });
    }
    const evidence = changingStatus && nextStatus === 'candidate'
      ? null : input.evidence === undefined ? existing.evidence : input.evidence;
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE modes SET title = ?, description = ?,
       capability_declaration_json = ?, validation_status = ?, evidence = ?,
       updated_at = ? WHERE id = ?`,
    ).run(input.title ?? existing.title, input.description ?? existing.description,
      JSON.stringify(input.capability_declaration ?? existing.capability_declaration),
      nextStatus, evidence, now, existing.id);
    return mapMode(db.prepare('SELECT * FROM modes WHERE id = ?').get(existing.id));
  })();
}
