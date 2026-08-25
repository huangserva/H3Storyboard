import { BindShotReferenceInputSchema, IdSchema,
  UpdateShotPlanInputSchema } from '@h3storyboard/protocol';
import type { ProjectStore } from '@h3storyboard/project-store';
import type { IncomingMessage } from 'node:http';
import { ApiError } from './api-error.js';
import { readJson } from './http.js';

interface Result { status: number; body: unknown }
const SHOT = /^\/api\/shots\/([^/]+)$/;
const COMPILE = /^\/api\/shots\/([^/]+)\/compile_bindings$/;
const BIND = /^\/api\/projects\/([^/]+)\/shots\/([^/]+)\/bindings$/;

export async function dispatchShotProductionRoute(request: IncomingMessage,
  store: ProjectStore, method: string, pathname: string): Promise<Result | null> {
  const bind = BIND.exec(pathname);
  if (bind && method === 'POST') {
    const input = BindShotReferenceInputSchema.parse(await readJson(request));
    return { status: 200, body: store.bindShotReference(
      decodeId(bind[1] ?? '', 'project_id'),
      decodeId(bind[2] ?? '', 'shot_plan_id'), input) };
  }
  const compile = COMPILE.exec(pathname);
  if (compile && method === 'POST') return { status: 200,
    body: store.production.compileBindings(
      decodeId(compile[1] ?? '', 'shot_plan_id')) };
  const shot = SHOT.exec(pathname);
  if (shot && method === 'PATCH') {
    const body = await readJson(request) as Record<string, unknown>;
    const input = UpdateShotPlanInputSchema.parse({ ...body,
      shot_plan_id: decodeId(shot[1] ?? '', 'shot_plan_id') });
    return { status: 200, body: store.updateShotPlan(input) };
  }
  return null;
}

function decodeId(value: string, name: string): string {
  try {
    const parsed = IdSchema.safeParse(decodeURIComponent(value));
    if (parsed.success) return parsed.data;
  } catch (error) {
    if (!(error instanceof URIError)) throw error;
  }
  throw new ApiError(400, 'ROUTE_PARAMETER_INVALID', `${name} is invalid`);
}
