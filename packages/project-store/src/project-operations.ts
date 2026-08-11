import {
  CreateAssetInputSchema,
  CreateProjectInputSchema,
  ProjectSnapshotSchema,
  type Asset,
  type CreateAssetInput,
  type CreateProjectInput,
  type Project,
  type ProjectSnapshot,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { StoreError } from './errors.js';
import { parseInput } from './input.js';
import {
  mapAsset,
  mapH3Job,
  mapProject,
  mapScriptVersion,
  mapShotActual,
  mapShotPlan,
} from './row-mappers.js';

export function createProject(
  db: Database.Database,
  rawInput: CreateProjectInput,
): Project {
  const input = parseInput(CreateProjectInputSchema, rawInput);
  return db.transaction(() => {
    const projectId = randomUUID();
    const scriptId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO projects
       (id, title, status, active_script_version_id, created_at, updated_at)
       VALUES (?, ?, 'active', ?, ?, ?)`,
    ).run(projectId, input.title, scriptId, now, now);
    db.prepare(
      `INSERT INTO script_versions
       (id, project_id, version, title, content, status, created_at, locked_at)
       VALUES (?, ?, 1, ?, ?, 'locked', ?, ?)`,
    ).run(
      scriptId,
      projectId,
      input.script_title,
      input.script_content,
      now,
      now,
    );
    return mapProject(
      db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId),
    );
  })();
}

export function listProjects(db: Database.Database): Project[] {
  return db
    .prepare('SELECT * FROM projects ORDER BY updated_at DESC, id ASC')
    .all()
    .map(mapProject);
}

export function getProjectSnapshot(
  db: Database.Database,
  projectId: string,
): ProjectSnapshot {
  return db.transaction(() => {
    const projectRow = db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(projectId);
    if (!projectRow) {
      throw new StoreError('PROJECT_NOT_FOUND', 'Project does not exist', {
        project_id: projectId,
      });
    }
    const project = mapProject(projectRow);
    const scriptRow = db
      .prepare('SELECT * FROM script_versions WHERE id = ?')
      .get(project.active_script_version_id);
    if (!scriptRow) {
      throw new StoreError(
        'SCRIPT_VERSION_NOT_FOUND',
        'Active script version does not exist',
        { script_version_id: project.active_script_version_id },
      );
    }
    return parseInput(
      ProjectSnapshotSchema,
      {
        project,
        script_version: mapScriptVersion(scriptRow),
        assets: db
          .prepare(
            'SELECT * FROM assets WHERE project_id = ? ORDER BY created_at, id',
          )
          .all(projectId)
          .map(mapAsset),
        shot_plans: db
          .prepare(
            'SELECT * FROM shot_plans WHERE project_id = ? ORDER BY ordinal',
          )
          .all(projectId)
          .map(mapShotPlan),
        shot_actuals: db
          .prepare(
            `SELECT * FROM shot_actuals
             WHERE project_id = ? ORDER BY shot_plan_id, attempt_number`,
          )
          .all(projectId)
          .map(mapShotActual),
        h3_jobs: db
          .prepare(
            'SELECT * FROM h3_jobs WHERE project_id = ? ORDER BY created_at, id',
          )
          .all(projectId)
          .map(mapH3Job),
      },
      'DATABASE_RECORD_INVALID',
    );
  })();
}

export function createAsset(
  db: Database.Database,
  projectId: string,
  rawInput: CreateAssetInput,
): Asset {
  const input = parseInput(CreateAssetInputSchema, rawInput);
  return db.transaction(() => {
    const project = db
      .prepare('SELECT id FROM projects WHERE id = ?')
      .get(projectId);
    if (!project) {
      throw new StoreError('PROJECT_NOT_FOUND', 'Project does not exist', {
        project_id: projectId,
      });
    }
    if (input.derived_from_asset_id !== null) {
      const source = db
        .prepare('SELECT project_id, kind FROM assets WHERE id = ?')
        .get(input.derived_from_asset_id) as
        | { project_id: string; kind: string }
        | undefined;
      if (!source) {
        throw new StoreError('ASSET_NOT_FOUND', 'Source asset does not exist', {
          asset_id: input.derived_from_asset_id,
        });
      }
      if (source.project_id !== projectId) {
        throw new StoreError(
          'ASSET_PROJECT_MISMATCH',
          'Source asset belongs to another project',
          { asset_id: input.derived_from_asset_id, project_id: projectId },
        );
      }
      if (source.kind !== 'video') {
        throw new StoreError(
          'ASSET_DERIVATION_INVALID',
          'Boundary frames must be derived from a video asset',
          { asset_id: input.derived_from_asset_id, asset_kind: source.kind },
        );
      }
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO assets
       (id, project_id, kind, name, relative_path, content_hash,
        derived_from_asset_id, derivation_kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      projectId,
      input.kind,
      input.name,
      input.relative_path,
      input.content_hash,
      input.derived_from_asset_id,
      input.derivation_kind,
      now,
    );
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(
      now,
      projectId,
    );
    return mapAsset(db.prepare('SELECT * FROM assets WHERE id = ?').get(id));
  })();
}
