import {
  CreateH3JobInputSchema,
  CreateProjectInputSchema,
  CreateShotActualInputSchema,
  CreateShotPlanInputSchema,
  PROTOCOL_VERSION,
  ReviewShotActualInputSchema,
  type CreateH3JobInput,
} from '@h3storyboard/protocol';
import type { ProjectStore } from '@h3storyboard/project-store';
import type { IncomingMessage } from 'node:http';
import { ApiError } from './api-error.js';
import { readJson } from './http.js';
import { dispatchCanvasRoute } from './canvas-routes.js';
import { dispatchCharacterRoute } from './character-routes.js';
import { dispatchAssetRoute } from './asset-routes.js';
import { dispatchModeRoute } from './mode-routes.js';
import { dispatchBriefRoute } from './brief-routes.js';
import { dispatchShotProductionRoute } from './shot-production-routes.js';
import { dispatchRepresentativeRoute } from './representative-routes.js';

interface RouteResult {
  status: number;
  body: unknown;
}

interface RouteContext {
  request: IncomingMessage;
  params: Readonly<Record<string, string>>;
  store: ProjectStore;
}

interface Route {
  method: string;
  pattern: RegExp;
  param_names: readonly string[];
  handle(context: RouteContext): Promise<RouteResult>;
}

const routes: readonly Route[] = [
  {
    method: 'GET',
    pattern: /^\/api\/health$/,
    param_names: [],
    handle: async () => ({
      status: 200,
      body: { status: 'ok', protocol_version: PROTOCOL_VERSION },
    }),
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects$/,
    param_names: [],
    handle: async ({ store }) => ({
      status: 200,
      body: store.listProjects(),
    }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/projects$/,
    param_names: [],
    handle: async ({ request, store }) => ({
      status: 201,
      body: store.createProject(
        CreateProjectInputSchema.parse(await readJson(request)),
      ),
    }),
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/([^/]+)$/,
    param_names: ['project_id'],
    handle: async ({ params, store }) => ({
      status: 200,
      body: store.getProjectSnapshot(requiredParam(params, 'project_id')),
    }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/projects\/([^/]+)\/shots$/,
    param_names: ['project_id'],
    handle: async ({ request, params, store }) => ({
      status: 201,
      body: store.createShotPlan(
        requiredParam(params, 'project_id'),
        CreateShotPlanInputSchema.parse(await readJson(request)),
      ),
    }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/shots\/([^/]+)\/jobs$/,
    param_names: ['shot_plan_id'],
    handle: async ({ request, params, store }) => ({
      status: 201,
      body: store.createH3Job(
        requiredParam(params, 'shot_plan_id'),
        await readH3JobInput(request),
      ),
    }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/shots\/([^/]+)\/actuals$/,
    param_names: ['shot_plan_id'],
    handle: async ({ request, params, store }) => ({
      status: 201,
      body: store.createShotActual(
        requiredParam(params, 'shot_plan_id'),
        CreateShotActualInputSchema.parse(await readJson(request)),
      ),
    }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/actuals\/([^/]+)\/review$/,
    param_names: ['actual_id'],
    handle: async ({ request, params, store }) => ({
      status: 200,
      body: store.reviewShotActual(
        requiredParam(params, 'actual_id'),
        ReviewShotActualInputSchema.parse(await readJson(request)),
      ),
    }),
  },
];

export async function dispatchRoute(
  request: IncomingMessage,
  store: ProjectStore,
): Promise<RouteResult> {
  const method = request.method ?? 'GET';
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  const canvasResult = await dispatchCanvasRoute(
    request,
    store,
    method,
    pathname,
  );
  if (canvasResult) return canvasResult;
  const characterResult = await dispatchCharacterRoute(
    request, store, method, pathname,
  );
  if (characterResult) return characterResult;
  const assetResult = await dispatchAssetRoute(request, store, method, pathname);
  if (assetResult) return assetResult;
  const modeResult = await dispatchModeRoute(request, store, method, pathname);
  if (modeResult) return modeResult;
  const briefResult = await dispatchBriefRoute(request, store, method, pathname);
  if (briefResult) return briefResult;
  const shotProductionResult = await dispatchShotProductionRoute(
    request, store, method, pathname);
  if (shotProductionResult) return shotProductionResult;
  const representativeResult = await dispatchRepresentativeRoute(
    request, store, method, pathname);
  if (representativeResult) return representativeResult;

  for (const route of routes) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(pathname);
    if (!match) continue;

    const params = Object.fromEntries(
      route.param_names.map((name, index) => [
        name,
        decodeRouteParam(match[index + 1] ?? ''),
      ]),
    );
    return route.handle({ request, params, store });
  }

  throw new ApiError(404, 'ROUTE_NOT_FOUND', 'API route was not found');
}

function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ApiError(
      400,
      'ROUTE_PARAMETER_INVALID',
      'Route parameter is not valid URI encoding',
    );
  }
}

function requiredParam(
  params: Readonly<Record<string, string>>,
  name: string,
): string {
  const value = params[name];
  if (!value) {
    throw new ApiError(400, 'ROUTE_PARAMETER_MISSING', `${name} is required`);
  }
  return value;
}

async function readH3JobInput(
  request: IncomingMessage,
): Promise<CreateH3JobInput> {
  const result = CreateH3JobInputSchema.safeParse(await readJson(request));
  if (!result.success) {
    throw new ApiError(
      422,
      'H3_BINDINGS_INVALID',
      'H3 job input does not satisfy the provider contract',
      result.error.issues,
    );
  }
  return result.data;
}
