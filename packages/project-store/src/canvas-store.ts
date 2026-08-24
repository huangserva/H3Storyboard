import type {
  BatchUpsertCanvasNodesInput,
  BatchUpsertCanvasNodesResult,
  CanvasNode,
  CreateCanvasNodeInput,
  UpdateCanvasNodeInput,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import {
  batchUpsertCanvasNodes,
  createCanvasNode,
  listCanvasNodes,
  updateCanvasNode,
} from './canvas-operations.js';

export class CanvasStore {
  constructor(private readonly database: Database.Database) {}

  list(projectId: string): CanvasNode[] {
    return listCanvasNodes(this.database, projectId);
  }

  batchUpsert(projectId: string,
    input: BatchUpsertCanvasNodesInput): BatchUpsertCanvasNodesResult {
    return batchUpsertCanvasNodes(this.database, projectId, input);
  }

  create(projectId: string, input: CreateCanvasNodeInput): CanvasNode {
    return createCanvasNode(this.database, projectId, input);
  }

  update(projectId: string, input: UpdateCanvasNodeInput): CanvasNode {
    return updateCanvasNode(this.database, projectId, input);
  }
}
