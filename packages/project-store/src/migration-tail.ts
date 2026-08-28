import type Database from 'better-sqlite3';
import { addWorkerCancellationReason } from './migration-v14.js';
import { addProviderSubmitIntent } from './migration-v15.js';
import { addJobAudioMode } from './migration-v16.js';
import { addCharacterReferenceUploads } from './migration-v17.js';
import { createCharacterAssetDerivations } from './migration-v18.js';
import { enforceCharacterPrimaryReferences } from './migration-v19.js';
import { createCharacterImageJobsAndGpuLeases } from './migration-v20.js';
import { enforceSingleCharacterImageRetry } from './migration-v21.js';
import { createH3BatchOrchestration } from './migration-v22.js';
import { addH3BatchFairnessCursor } from './migration-v23.js';
import { createScriptStudio } from './migration-v24.js';
import { createPlanReviewWorkflow } from './migration-v25.js';
import { addScriptGenerationProvenance } from './migration-v26.js';
import { addScriptGenerationReview } from './migration-v27.js';
import { addScriptGenerationInputs } from './migration-v28.js';

const tailMigrations: Array<readonly [number,
  (database: Database.Database) => void]> = [
  [14, addWorkerCancellationReason],
  [15, addProviderSubmitIntent],
  [16, addJobAudioMode],
  [17, addCharacterReferenceUploads],
  [18, createCharacterAssetDerivations],
  [19, enforceCharacterPrimaryReferences],
  [20, createCharacterImageJobsAndGpuLeases],
  [21, enforceSingleCharacterImageRetry],
  [22, createH3BatchOrchestration],
  [23, addH3BatchFairnessCursor],
  [24, createScriptStudio],
  [25, createPlanReviewWorkflow],
  [26, addScriptGenerationProvenance],
  [27, addScriptGenerationReview],
  [28, addScriptGenerationInputs],
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
