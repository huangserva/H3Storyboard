import {
  CreateProductionBriefInputSchema,
  ProjectGenerationLockSchema,
  UpdateProjectGenerationLockInputSchema,
  type CreateProductionBriefInput,
  type ProductionBrief,
  type ProjectGenerationLock,
  type UpdateProjectGenerationLockInput,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { StoreError } from './errors.js';
import { requireGenerationUnlocked, requireProject } from './generation-locks.js';
import { parseInput } from './input.js';
import { mapGenerationLock, mapProductionBrief } from './row-mappers.js';
import { compileShotBindings } from './binding-operations.js';
import type { CompiledBindingsResult } from '@h3storyboard/protocol';

export class ProductionStore {
  constructor(private readonly database: Database.Database) {}

  compileBindings(shotPlanId: string): CompiledBindingsResult {
    return this.database.transaction(() =>
      compileShotBindings(this.database, shotPlanId))();
  }

  listBriefs(projectId: string): ProductionBrief[] {
    return this.database.transaction(() => {
      requireProject(this.database, projectId);
      return this.database.prepare(
        `SELECT * FROM production_briefs WHERE project_id = ?
         ORDER BY brief_version`,
      ).all(projectId).map(mapProductionBrief);
    })();
  }

  createBrief(projectId: string,
    rawInput: CreateProductionBriefInput): ProductionBrief {
    const input = parseInput(CreateProductionBriefInputSchema, rawInput);
    return this.database.transaction(() => {
      requireProject(this.database, projectId);
      requireGenerationUnlocked(this.database, projectId);
      if (!this.database.prepare('SELECT id FROM modes WHERE key = ?')
        .get(input.mode_key)) {
        throw new StoreError('BRIEF_MODE_NOT_FOUND', 'Mode does not exist', {
          mode_key: input.mode_key,
        });
      }
      const latest = this.database.prepare(
        `SELECT MAX(brief_version) AS version FROM production_briefs
         WHERE project_id = ?`,
      ).get(projectId) as { version: number | null };
      const id = randomUUID();
      const version = (latest.version ?? 0) + 1;
      const now = new Date().toISOString();
      this.database.prepare(
        `INSERT INTO production_briefs
         (id, project_id, brief_version, mode_key, body_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, projectId, version, input.mode_key, JSON.stringify(input.body), now);
      return mapProductionBrief(this.database.prepare(
        'SELECT * FROM production_briefs WHERE id = ?',
      ).get(id));
    })();
  }

  getLock(projectId: string): ProjectGenerationLock {
    return this.database.transaction(() => {
      requireProject(this.database, projectId);
      const row = this.database.prepare(
        'SELECT * FROM project_generation_locks WHERE project_id = ?',
      ).get(projectId);
      return row ? mapGenerationLock(row) : ProjectGenerationLockSchema.parse({
        project_id: projectId, engaged: false, engaged_at: null,
        released_at: null, reason: null,
      });
    })();
  }

  updateLock(projectId: string,
    rawInput: UpdateProjectGenerationLockInput): ProjectGenerationLock {
    const input = parseInput(UpdateProjectGenerationLockInputSchema, rawInput);
    return this.database.transaction(() => {
      requireProject(this.database, projectId);
      const current = this.getLock(projectId);
      if (input.engaged && current.engaged) throw new StoreError(
        'LOCK_ALREADY_ENGAGED', 'Project generation lock is already engaged', {
          project_id: projectId,
        });
      if (!input.engaged && !current.engaged) throw new StoreError(
        'LOCK_NOT_ENGAGED', 'Project generation lock is not engaged', {
          project_id: projectId,
        });
      const now = new Date().toISOString();
      this.database.prepare(
        `INSERT INTO project_generation_locks
         (project_id, engaged, engaged_at, released_at, reason)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET engaged = excluded.engaged,
         engaged_at = excluded.engaged_at, released_at = excluded.released_at,
         reason = excluded.reason`,
      ).run(projectId, input.engaged ? 1 : 0,
        input.engaged ? now : current.engaged_at,
        input.engaged ? null : now,
        input.engaged ? input.reason : current.reason);
      return mapGenerationLock(this.database.prepare(
        'SELECT * FROM project_generation_locks WHERE project_id = ?',
      ).get(projectId));
    })();
  }
}
