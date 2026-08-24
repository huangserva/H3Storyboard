import type Database from 'better-sqlite3';
import { addWorkerCancellationReason } from './migration-v14.js';
import { addProviderSubmitIntent } from './migration-v15.js';
import { addJobAudioMode } from './migration-v16.js';
import { addCharacterReferenceUploads } from './migration-v17.js';
import { createCharacterAssetDerivations } from './migration-v18.js';
import { enforceCharacterPrimaryReferences } from './migration-v19.js';

const tailMigrations: Array<readonly [number,
  (database: Database.Database) => void]> = [
  [14, addWorkerCancellationReason],
  [15, addProviderSubmitIntent],
  [16, addJobAudioMode],
  [17, addCharacterReferenceUploads],
  [18, createCharacterAssetDerivations],
  [19, enforceCharacterPrimaryReferences],
];

export function applyTailMigrations(
  database: Database.Database,
  appliedVersions: Set<number>,
): void {
  for (const [version, migrate] of tailMigrations) {
    if (appliedVersions.has(version)) continue;
    migrate(database);
    database.prepare(
      'INSERT INTO schema_version (version, applied_at) VALUES (?, ?)',
    ).run(version, new Date().toISOString());
  }
}
