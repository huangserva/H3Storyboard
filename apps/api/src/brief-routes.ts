import {
  CreateProductionBriefInputSchema,
  UpdateProjectGenerationLockInputSchema,
} from '@h3storyboard/protocol';
import type { ProjectStore } from '@h3storyboard/project-store';
import type { IncomingMessage } from 'node:http';
import { ApiError } from './api-error.js';
import { readJson } from './http.js';

interface BriefRouteResult { status: number; body: unknown }

const BRIEFS = /^\/api\/projects\/([^/]+)\/briefs$/;
const LOCK = /^\/api\/projects\/([^/]+)\/generation_lock$/;

export async function dispatchBriefRoute(request: IncomingMessage,
  store: ProjectStore, method: string,
  pathname: string): Promise<BriefRouteResult | null> {
  const briefs = BRIEFS.exec(pathname);
  if (briefs && (method === 'GET' || method === 'POST')) {
    const projectId = decodeProjectId(briefs[1] ?? '');
    if (method === 'GET') return { status: 200,
      body: store.production.listBriefs(projectId) };
    return { status: 201, body: store.production.createBrief(projectId,
      CreateProductionBriefInputSchema.parse(await readJson(request))) };
  }
  const lock = LOCK.exec(pathname);
  if (lock && (method === 'GET' || method === 'PUT')) {
    const projectId = decodeProjectId(lock[1] ?? '');
    if (method === 'GET') return { status: 200,
      body: store.production.getLock(projectId) };
    return { status: 200, body: store.production.updateLock(projectId,
      UpdateProjectGenerationLockInputSchema.parse(await readJson(request))) };
  }
  return null;
}

function decodeProjectId(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded) throw new Error('empty');
    return decoded;
  } catch {
    throw new ApiError(400, 'ROUTE_PARAMETER_INVALID', 'project_id is invalid');
  }
}
