import { UpdateShotPlanInputSchema } from '@h3storyboard/protocol';
import type { ProjectStore } from '@h3storyboard/project-store';
import type { IncomingMessage } from 'node:http';
import { readJson } from './http.js';

interface Result { status: number; body: unknown }
const SHOT = /^\/api\/shots\/([^/]+)$/;
const COMPILE = /^\/api\/shots\/([^/]+)\/compile_bindings$/;

export async function dispatchShotProductionRoute(request: IncomingMessage,
  store: ProjectStore, method: string, pathname: string): Promise<Result | null> {
  const compile = COMPILE.exec(pathname);
  if (compile && method === 'POST') return { status: 200,
    body: store.production.compileBindings(decodeURIComponent(compile[1] ?? '')) };
  const shot = SHOT.exec(pathname);
  if (shot && method === 'PATCH') {
    const body = await readJson(request) as Record<string, unknown>;
    const input = UpdateShotPlanInputSchema.parse({ ...body,
      shot_plan_id: decodeURIComponent(shot[1] ?? '') });
    return { status: 200, body: store.updateShotPlan(input) };
  }
  return null;
}
