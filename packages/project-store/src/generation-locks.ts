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

export function requireAllGenerationUnlocked(db: Database.Database): void {
  const locked = db.prepare(`SELECT project_id FROM project_generation_locks
    WHERE engaged = 1 ORDER BY project_id LIMIT 1`).get() as
    { project_id: string } | undefined;
  if (locked) throw new StoreError('LOCK_ENGAGED',
    'Mode capability cannot change while any project generation lock is engaged',
    { project_id: locked.project_id });
}

export function buildJobLockSnapshot(db: Database.Database,
  projectId: string): JobLockSnapshot {
  const lock = db.prepare(
    `SELECT engaged, engaged_at FROM project_generation_locks
     WHERE project_id = ?`,
  ).get(projectId) as { engaged: number; engaged_at: string | null } | undefined;
  const brief = db.prepare(
    `SELECT b.brief_version, b.mode_key, m.validation_status
     FROM production_briefs b JOIN modes m ON m.key = b.mode_key
     WHERE b.project_id = ? ORDER BY b.brief_version DESC LIMIT 1`,
  ).get(projectId) as { brief_version: number; mode_key: string;
    validation_status: string } | undefined;
  const manifest = db.prepare(
    `SELECT manifest_version FROM current_assets_manifests
     WHERE project_id = ? ORDER BY manifest_version DESC LIMIT 1`,
  ).get(projectId) as { manifest_version: number } | undefined;
  const missingSteps = [
    !brief ? 'create a production brief' : null,
    !manifest ? 'approve assets and freeze a current-assets manifest' : null,
    lock?.engaged !== 1 || lock.engaged_at === null
      ? 'engage the project generation lock' : null,
  ].filter((step): step is string => step !== null);
  if (missingSteps.length > 0) {
    const code = lock?.engaged !== 1 || lock.engaged_at === null
      ? 'LOCK_REQUIRED' : !brief ? 'BRIEF_REQUIRED' : 'MANIFEST_REQUIRED';
    throw new StoreError(code,
      `Production context setup required: ${missingSteps.join('; ')}`, {
        project_id: projectId, missing_steps: missingSteps,
      });
  }
  if (brief!.validation_status === 'blocked') throw new StoreError(
    'MODE_BLOCKED', 'Blocked modes cannot create generation jobs', {
      project_id: projectId, mode_key: brief!.mode_key,
    });
  return JobLockSnapshotSchema.parse({
    brief_version: brief!.brief_version,
    manifest_version: manifest!.manifest_version,
    mode_key: brief!.mode_key,
    locked_at: lock!.engaged_at!,
  });
}
