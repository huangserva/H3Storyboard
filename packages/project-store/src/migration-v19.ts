import type Database from 'better-sqlite3';

interface PrimaryReferenceRow {
  id: string;
  character_id: string;
  derived_from: string | null;
}

export function enforceCharacterPrimaryReferences(db: Database.Database): void {
  const primaryRows = db.prepare(
    `SELECT id, character_id, derived_from
     FROM character_references WHERE sort_order = 0
     ORDER BY character_id,
       CASE WHEN derived_from IS NULL THEN 0 ELSE 1 END,
       created_at, id`,
  ).all() as PrimaryReferenceRow[];
  const keptRoot = new Set<string>();
  const nextOrder = new Map<string, number>();
  const maximum = db.prepare(
    `SELECT character_id, COALESCE(MAX(sort_order), 0) AS maximum
     FROM character_references GROUP BY character_id`,
  ).all() as Array<{ character_id: string; maximum: number }>;
  for (const row of maximum) nextOrder.set(row.character_id, row.maximum);
  const update = db.prepare(
    `UPDATE character_references SET sort_order = ?, updated_at = ? WHERE id = ?`,
  );
  const now = new Date().toISOString();
  for (const row of primaryRows) {
    if (row.derived_from === null && !keptRoot.has(row.character_id)) {
      keptRoot.add(row.character_id);
      continue;
    }
    const order = (nextOrder.get(row.character_id) ?? 0) + 1;
    nextOrder.set(row.character_id, order);
    update.run(order, now, row.id);
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_character_references_primary
      ON character_references(character_id) WHERE sort_order = 0;
    CREATE TRIGGER IF NOT EXISTS trg_character_reference_derived_primary_insert
      BEFORE INSERT ON character_references
      WHEN NEW.derived_from IS NOT NULL AND NEW.sort_order = 0
      BEGIN
        SELECT RAISE(ABORT, 'derived character reference cannot be primary');
      END;
    CREATE TRIGGER IF NOT EXISTS trg_character_reference_derived_primary_update
      BEFORE UPDATE OF derived_from, sort_order ON character_references
      WHEN NEW.derived_from IS NOT NULL AND NEW.sort_order = 0
      BEGIN
        SELECT RAISE(ABORT, 'derived character reference cannot be primary');
      END;
  `);
}
