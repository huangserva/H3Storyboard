import {
  BatchUpsertCanvasNodesInputSchema,
  BatchUpsertCanvasNodesResultSchema,
  CreateCanvasNodeInputSchema,
  UpdateCanvasNodeInputSchema,
} from '@h3storyboard/protocol';
import type { ProjectStore } from '@h3storyboard/project-store';
import type { IncomingMessage } from 'node:http';
import { ApiError, parseResponseContract } from './api-error.js';
import { readJson } from './http.js';

export interface CanvasRouteResult {
  status: number;
  body: unknown;
}
const PATTERN = /^\/api\/projects\/([^/]+)\/canvas_nodes$/;

export async function dispatchCanvasRoute(
  request: IncomingMessage,
  store: ProjectStore,
  method: string,
  pathname: string,
): Promise<CanvasRouteResult | null> {
  if (method !== 'GET' && method !== 'POST' && method !== 'PATCH' &&
    method !== 'PUT') return null;
  const match = PATTERN.exec(pathname);
  if (!match) return null;
  const projectId = decodeProjectId(match[1] ?? '');

  if (method === 'GET') {
    return { status: 200, body: store.canvas.list(projectId) };
  }
  if (method === 'POST') {
    return {
      status: 201,
      body: store.canvas.create(
        projectId,
        CreateCanvasNodeInputSchema.parse(await readJson(request)),
      ),
    };
  }
  if (method === 'PUT') {
    return {
      status: 200,
      body: parseResponseContract(BatchUpsertCanvasNodesResultSchema,
        store.canvas.batchUpsert(projectId,
          BatchUpsertCanvasNodesInputSchema.parse(await readJson(request)))),
    };
  }
  return {
    status: 200,
    body: store.canvas.update(
      projectId,
      UpdateCanvasNodeInputSchema.parse(await readJson(request)),
    ),
  };
}

function decodeProjectId(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded) throw new Error('empty');
    return decoded;
  } catch {
    throw new ApiError(
      400,
      'ROUTE_PARAMETER_INVALID',
      'project_id is not valid URI encoding',
    );
  }
}
