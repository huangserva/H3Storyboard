import {
  CreateCanvasNodeInputSchema,
  UpdateCanvasNodeInputSchema,
  type CanvasNode,
  type CreateCanvasNodeInput,
  type UpdateCanvasNodeInput,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { StoreError } from './errors.js';
import { parseInput } from './input.js';
import { mapCanvasNode } from './row-mappers.js';

function requireProject(db: Database.Database, projectId: string): void {
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) {
    throw new StoreError('PROJECT_NOT_FOUND', 'Project does not exist', {
      project_id: projectId,
    });
  }
}
export function listCanvasNodes(
  db: Database.Database,
  projectId: string,
): CanvasNode[] {
  return db.transaction(() => {
    requireProject(db, projectId);
    return db
      .prepare(
        `SELECT * FROM canvas_nodes
         WHERE project_id = ? ORDER BY z_index, created_at, id`,
      )
      .all(projectId)
      .map(mapCanvasNode);
  })();
}

export function createCanvasNode(
  db: Database.Database,
  projectId: string,
  rawInput: CreateCanvasNodeInput,
): CanvasNode {
  const input = parseInput(CreateCanvasNodeInputSchema, rawInput);
  return db.transaction(() => {
    requireProject(db, projectId);
    const shot = db
      .prepare('SELECT project_id FROM shot_plans WHERE id = ?')
      .get(input.ref_id) as { project_id: string } | undefined;
    if (!shot) {
      throw new StoreError('SHOT_PLAN_NOT_FOUND', 'Shot plan does not exist', {
        shot_plan_id: input.ref_id,
      });
    }
    if (shot.project_id !== projectId) {
      throw new StoreError(
        'CANVAS_NODE_REF_PROJECT_MISMATCH',
        'Canvas node reference belongs to another project',
        { project_id: projectId, ref_id: input.ref_id },
      );
    }
    const duplicate = db
      .prepare(
        `SELECT id FROM canvas_nodes
         WHERE project_id = ? AND node_type = ? AND ref_id = ?`,
      )
      .get(projectId, input.node_type, input.ref_id);
    if (duplicate) {
      throw new StoreError(
        'CANVAS_NODE_CONFLICT',
        'Canvas node already exists for this reference',
        { project_id: projectId, ref_id: input.ref_id },
      );
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO canvas_nodes
       (id, project_id, node_type, ref_id, x, y, width, height, z_index,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      projectId,
      input.node_type,
      input.ref_id,
      input.x,
      input.y,
      input.width,
      input.height,
      input.z_index,
      now,
      now,
    );
    return mapCanvasNode(
      db.prepare('SELECT * FROM canvas_nodes WHERE id = ?').get(id),
    );
  })();
}

export function updateCanvasNode(
  db: Database.Database,
  projectId: string,
  rawInput: UpdateCanvasNodeInput,
): CanvasNode {
  const input = parseInput(UpdateCanvasNodeInputSchema, rawInput);
  return db.transaction(() => {
    requireProject(db, projectId);
    const existingRow = db
      .prepare('SELECT * FROM canvas_nodes WHERE id = ? AND project_id = ?')
      .get(input.node_id, projectId);
    if (!existingRow) {
      throw new StoreError('CANVAS_NODE_NOT_FOUND', 'Canvas node does not exist', {
        project_id: projectId,
        node_id: input.node_id,
      });
    }
    const existing = mapCanvasNode(existingRow);
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE canvas_nodes
       SET x = ?, y = ?, width = ?, height = ?, z_index = ?, updated_at = ?
       WHERE id = ? AND project_id = ?`,
    ).run(
      input.x ?? existing.x,
      input.y ?? existing.y,
      input.width ?? existing.width,
      input.height ?? existing.height,
      input.z_index ?? existing.z_index,
      now,
      input.node_id,
      projectId,
    );
    return mapCanvasNode(
      db.prepare('SELECT * FROM canvas_nodes WHERE id = ?').get(input.node_id),
    );
  })();
}
