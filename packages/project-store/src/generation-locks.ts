import { JobLockSnapshotSchema, type JobLockSnapshot } from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { StoreError } from './errors.js';

export function requireProject(db: Database.Database, projectId: string): void {
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) {
    throw new StoreError('PROJECT_NOT_FOUND', 'Project does not exist', {
      project_id: projectId,
    });
  }
}

export function isGenerationLocked(db: Database.Database,
  projectId: string): boolean {
  const row = db.prepare(
    'SELECT engaged FROM project_generation_locks WHERE project_id = ?',
  ).get(projectId) as { engaged: number } | undefined;
  return row?.engaged === 1;
}

export function requireGenerationUnlocked(db: Database.Database,
  projectId: string): void {
  if (isGenerationLocked(db, projectId)) {
    throw new StoreError('LOCK_ENGAGED',
      'Project generation lock prevents production context changes', {
        project_id: projectId,
      });
  }
}

export function buildJobLockSnapshot(db: Database.Database,
  projectId: string): JobLockSnapshot {
  const lock = db.prepare(
    `SELECT engaged, engaged_at FROM project_generation_locks
     WHERE project_id = ?`,
  ).get(projectId) as { engaged: number; engaged_at: string | null } | undefined;
  if (lock?.engaged !== 1 || lock.engaged_at === null) {
    throw new StoreError('LOCK_REQUIRED',
      'Project generation lock must be engaged before creating a job', {
        project_id: projectId,
      });
  }
  const brief = db.prepare(
    `SELECT brief_version, mode_key FROM production_briefs
     WHERE project_id = ? ORDER BY brief_version DESC LIMIT 1`,
  ).get(projectId) as { brief_version: number; mode_key: string } | undefined;
  if (!brief) throw new StoreError('BRIEF_REQUIRED',
    'A production brief is required before creating a job', {
      project_id: projectId,
    });
  const manifest = db.prepare(
    `SELECT manifest_version FROM current_assets_manifests
     WHERE project_id = ? ORDER BY manifest_version DESC LIMIT 1`,
  ).get(projectId) as { manifest_version: number } | undefined;
  if (!manifest) throw new StoreError('MANIFEST_REQUIRED',
    'A current-assets manifest is required before creating a job', {
      project_id: projectId,
    });
  return JobLockSnapshotSchema.parse({
    brief_version: brief.brief_version,
    manifest_version: manifest.manifest_version,
    mode_key: brief.mode_key,
    locked_at: lock.engaged_at,
  });
}
