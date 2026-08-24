import {
  BatchUpsertCanvasNodesInputSchema,
  CreateCanvasNodeInputSchema,
  UpdateCanvasNodeInputSchema,
  type BatchUpsertCanvasNodesInput,
  type BatchUpsertCanvasNodesResult,
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

function selectCanvasNodes(db: Database.Database,
  projectId: string): CanvasNode[] {
  return db.prepare(
    `SELECT * FROM canvas_nodes
     WHERE project_id = ? ORDER BY z_index, created_at, id`,
  ).all(projectId).map(mapCanvasNode);
}

export function listCanvasNodes(
  db: Database.Database,
  projectId: string,
): CanvasNode[] {
  return db.transaction(() => {
    requireProject(db, projectId);
    return selectCanvasNodes(db, projectId);
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
    requireCanvasReference(db, projectId, input);
    const duplicate = db.prepare(
      `SELECT id FROM canvas_nodes
       WHERE project_id = ? AND node_type = ? AND ref_id = ?`,
    ).get(projectId, input.node_type, input.ref_id);
    if (duplicate) {
      throw new StoreError(
        'CANVAS_NODE_CONFLICT',
        'Canvas node already exists for this reference',
        { project_id: projectId, ref_id: input.ref_id },
      );
    }
    const id = insertCanvasNode(db, projectId, input);
    return canvasNodeById(db, id);
  })();
}

export function batchUpsertCanvasNodes(
  db: Database.Database,
  projectId: string,
  rawInput: BatchUpsertCanvasNodesInput,
): BatchUpsertCanvasNodesResult {
  const input = parseInput(BatchUpsertCanvasNodesInputSchema, rawInput);
  const transaction = db.transaction(() => {
    requireProject(db, projectId);
    for (const node of input.nodes) {
      requireCanvasReference(db, projectId, node);
    }

    let createdCount = 0;
    let updatedCount = 0;
    for (const node of input.nodes) {
      const id = randomUUID();
      const now = new Date().toISOString();
      const insertion = db.prepare(
        `INSERT INTO canvas_nodes
         (id, project_id, node_type, ref_id, x, y, width, height, z_index,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, node_type, ref_id) DO NOTHING`,
      ).run(id, projectId, node.node_type, node.ref_id, node.x, node.y,
        node.width, node.height, node.z_index, now, now);
      if (insertion.changes === 1) {
        createdCount += 1;
        continue;
      }
      if (!node.update_position_if_untouched) continue;
      const existing = canvasNodeByReference(
        db, projectId, node.node_type, node.ref_id);
      if (existing.created_at !== existing.updated_at ||
        !positionChanged(existing, node)) continue;
      db.prepare(
        `UPDATE canvas_nodes
         SET x = ?, y = ?, updated_at = ?
         WHERE id = ? AND project_id = ?`,
      ).run(node.x, node.y, nextTimestamp(existing.updated_at),
        existing.id, projectId);
      updatedCount += 1;
    }

    return { canvas_nodes: selectCanvasNodes(db, projectId),
      created_count: createdCount, updated_count: updatedCount };
  });
  return transaction.immediate();
}

export function updateCanvasNode(
  db: Database.Database,
  projectId: string,
  rawInput: UpdateCanvasNodeInput,
): CanvasNode {
  const input = parseInput(UpdateCanvasNodeInputSchema, rawInput);
  return db.transaction(() => {
    requireProject(db, projectId);
    const existingRow = db.prepare(
      'SELECT * FROM canvas_nodes WHERE id = ? AND project_id = ?',
    ).get(input.node_id, projectId);
    if (!existingRow) {
      throw new StoreError('CANVAS_NODE_NOT_FOUND', 'Canvas node does not exist', {
        project_id: projectId,
        node_id: input.node_id,
      });
    }
    const existing = mapCanvasNode(existingRow);
    const now = nextTimestamp(existing.updated_at);
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
    return canvasNodeById(db, input.node_id);
  })();
}

function requireCanvasReference(db: Database.Database, projectId: string,
  input: Pick<CreateCanvasNodeInput, 'node_type' | 'ref_id'>): void {
  const reference = input.node_type === 'shot_plan'
    ? db.prepare('SELECT project_id, NULL AS status FROM shot_plans WHERE id = ?')
        .get(input.ref_id)
    : db.prepare('SELECT project_id, status FROM characters WHERE id = ?')
        .get(input.ref_id);
  if (!reference) {
    throw new StoreError(
      input.node_type === 'shot_plan' ? 'SHOT_PLAN_NOT_FOUND' : 'CHARACTER_NOT_FOUND',
      input.node_type === 'shot_plan'
        ? 'Shot plan does not exist' : 'Character does not exist',
      { ref_id: input.ref_id },
    );
  }
  const typedReference = reference as { project_id: string; status: string | null };
  if (typedReference.project_id !== projectId) {
    throw new StoreError(
      'CANVAS_NODE_REF_PROJECT_MISMATCH',
      'Canvas node reference belongs to another project',
      { project_id: projectId, ref_id: input.ref_id },
    );
  }
  if (input.node_type === 'character' && typedReference.status === 'archived') {
    throw new StoreError('CHARACTER_ARCHIVED',
      'Archived character cannot enter canvas', { character_id: input.ref_id });
  }
}

function insertCanvasNode(db: Database.Database, projectId: string,
  input: CreateCanvasNodeInput): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO canvas_nodes
     (id, project_id, node_type, ref_id, x, y, width, height, z_index,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, projectId, input.node_type, input.ref_id, input.x, input.y,
    input.width, input.height, input.z_index, now, now);
  return id;
}

function canvasNodeById(db: Database.Database, id: string): CanvasNode {
  return mapCanvasNode(db.prepare(
    'SELECT * FROM canvas_nodes WHERE id = ?',
  ).get(id));
}

function canvasNodeByReference(db: Database.Database, projectId: string,
  nodeType: CanvasNode['node_type'], refId: string): CanvasNode {
  return mapCanvasNode(db.prepare(
    `SELECT * FROM canvas_nodes
     WHERE project_id = ? AND node_type = ? AND ref_id = ?`,
  ).get(projectId, nodeType, refId));
}

function positionChanged(existing: CanvasNode,
  candidate: CreateCanvasNodeInput): boolean {
  return existing.x !== candidate.x || existing.y !== candidate.y;
}

function nextTimestamp(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}
