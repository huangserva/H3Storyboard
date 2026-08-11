import {
  MarkRepresentativeInputSchema,
  ReviewRepresentativeInputSchema,
  type MarkRepresentativeInput,
  type ReviewRepresentativeInput,
  type ShotActual,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { StoreError } from './errors.js';
import { parseInput } from './input.js';
import { mapShotActual } from './row-mappers.js';

function requireActual(db: Database.Database, actualId: string): ShotActual {
  const row = db.prepare('SELECT * FROM shot_actuals WHERE id = ?').get(actualId);
  if (!row) throw new StoreError('TAKE_NOT_FOUND', 'Generated take does not exist',
    { shot_actual_id: actualId });
  return mapShotActual(row);
}

export function markRepresentative(db: Database.Database, actualId: string,
  rawInput: MarkRepresentativeInput): ShotActual {
  const input = parseInput(MarkRepresentativeInputSchema, rawInput);
  return db.transaction(() => {
    const actual = requireActual(db, actualId);
    if (input.representative && actual.is_representative) return actual;
    if (!input.representative && !actual.is_representative) throw new StoreError(
      'TAKE_NOT_REPRESENTATIVE', 'Take is not the representative take',
      { shot_actual_id: actualId });
    if (input.representative) {
      const existing = db.prepare(`SELECT id FROM shot_actuals
        WHERE shot_plan_id = ? AND is_representative = 1`).get(
          actual.shot_plan_id) as { id: string } | undefined;
      if (existing) throw new StoreError('TAKE_REPRESENTATIVE_CONFLICT',
        'Withdraw the current representative take before selecting another',
        { shot_actual_id: actualId, representative_take_id: existing.id });
    }
    const now = new Date().toISOString();
    db.prepare(`UPDATE shot_actuals SET is_representative = ?,
      representative_status = ?, approved_at = NULL WHERE id = ?`)
      .run(input.representative ? 1 : 0,
        input.representative ? 'pending' : 'none', actualId);
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
      .run(now, actual.project_id);
    return requireActual(db, actualId);
  })();
}

export function reviewRepresentative(db: Database.Database, actualId: string,
  rawInput: ReviewRepresentativeInput): ShotActual {
  const input = parseInput(ReviewRepresentativeInputSchema, rawInput);
  return db.transaction(() => {
    const actual = requireActual(db, actualId);
    if (!actual.is_representative) throw new StoreError(
      'TAKE_NOT_REPRESENTATIVE', 'Only the selected representative can be reviewed',
      { shot_actual_id: actualId });
    if (actual.representative_status !== 'pending') throw new StoreError(
      'TAKE_REPRESENTATIVE_STATUS_INVALID',
      'A representative take may be approved or rejected exactly once',
      { shot_actual_id: actualId,
        representative_status: actual.representative_status });
    const now = new Date().toISOString();
    db.prepare(`UPDATE shot_actuals SET representative_status = ?,
      approved_at = ? WHERE id = ?`).run(
        input.representative_status,
        input.representative_status === 'approved' ? now : null,
        actualId,
      );
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
      .run(now, actual.project_id);
    return requireActual(db, actualId);
  })();
}
