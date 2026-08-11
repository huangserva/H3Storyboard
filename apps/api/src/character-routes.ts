import {
  CreateCharacterInputSchema,
  CreateCharacterReferenceInputSchema,
  UpdateCharacterInputSchema,
  UpdateCharacterReferenceInputSchema,
} from '@h3storyboard/protocol';
import type { ProjectStore } from '@h3storyboard/project-store';
import type { IncomingMessage } from 'node:http';
import { ApiError } from './api-error.js';
import { readJson } from './http.js';

interface CharacterRouteResult { status: number; body: unknown }

const CHARACTERS = /^\/api\/projects\/([^/]+)\/characters$/;
const REFERENCES = /^\/api\/projects\/([^/]+)\/characters\/([^/]+)\/references$/;

export async function dispatchCharacterRoute(
  request: IncomingMessage,
  store: ProjectStore,
  method: string,
  pathname: string,
): Promise<CharacterRouteResult | null> {
  if (method !== 'GET' && method !== 'POST' && method !== 'PATCH') return null;
  const characterMatch = CHARACTERS.exec(pathname);
  if (characterMatch) {
    const projectId = decodeParam(characterMatch[1] ?? '', 'project_id');
    if (method === 'GET') return { status: 200, body: store.listCharacters(projectId) };
    if (method === 'POST') return { status: 201, body: store.createCharacter(
      projectId, CreateCharacterInputSchema.parse(await readJson(request))) };
    return { status: 200, body: store.updateCharacter(
      projectId, UpdateCharacterInputSchema.parse(await readJson(request))) };
  }
  const referenceMatch = REFERENCES.exec(pathname);
  if (!referenceMatch) return null;
  const projectId = decodeParam(referenceMatch[1] ?? '', 'project_id');
  const characterId = decodeParam(referenceMatch[2] ?? '', 'character_id');
  if (method === 'GET') return { status: 200,
    body: store.listCharacterReferences(projectId, characterId) };
  if (method === 'POST') return { status: 201,
    body: store.createCharacterReference(projectId, characterId,
      CreateCharacterReferenceInputSchema.parse(await readJson(request))) };
  return { status: 200, body: store.updateCharacterReference(
    projectId, characterId,
    UpdateCharacterReferenceInputSchema.parse(await readJson(request))) };
}

function decodeParam(value: string, name: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded) throw new Error('empty');
    return decoded;
  } catch {
    throw new ApiError(400, 'ROUTE_PARAMETER_INVALID', `${name} is invalid`);
  }
}
