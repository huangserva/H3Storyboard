import {
  CreateModeInputSchema,
  UpdateModeInputSchema,
} from '@h3storyboard/protocol';
import type { ProjectStore } from '@h3storyboard/project-store';
import type { IncomingMessage } from 'node:http';
import { readJson } from './http.js';

interface ModeRouteResult { status: number; body: unknown }

export async function dispatchModeRoute(request: IncomingMessage,
  store: ProjectStore, method: string,
  pathname: string): Promise<ModeRouteResult | null> {
  if (pathname !== '/api/modes') return null;
  if (method === 'GET') return { status: 200, body: store.modes.list() };
  if (method === 'POST') return { status: 201, body: store.modes.create(
    CreateModeInputSchema.parse(await readJson(request)),
  ) };
  if (method === 'PATCH') return { status: 200, body: store.modes.update(
    UpdateModeInputSchema.parse(await readJson(request)),
  ) };
  return null;
}
