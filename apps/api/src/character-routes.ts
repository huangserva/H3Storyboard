import {
  ApproveCharacterReferenceInputSchema,
  ApproveCharacterReferenceResultSchema,
  CharacterCatalogSchema,
  CreateCharacterInputSchema,
  CreateCharacterReferenceInputSchema,
  UpdateCharacterInputSchema,
  UpdateCharacterReferenceInputSchema,
} from '@h3storyboard/protocol';
import type { ProjectStore } from '@h3storyboard/project-store';
import type { IncomingMessage } from 'node:http';
import { ApiError } from './api-error.js';
import { parseResponseContract } from './api-error.js';
import { readJson } from './http.js';

interface CharacterRouteResult { status: number; body: unknown }

const CHARACTERS = /^\/api\/projects\/([^/]+)\/characters$/;
const CHARACTER_CATALOG = /^\/api\/projects\/([^/]+)\/character_catalog$/;
const REFERENCES = /^\/api\/projects\/([^/]+)\/characters\/([^/]+)\/references$/;
const APPROVE_REFERENCE = /^\/api\/projects\/([^/]+)\/characters\/([^/]+)\/references\/([^/]+)\/approve$/;

export async function dispatchCharacterRoute(
  request: IncomingMessage,
  store: ProjectStore,
  method: string,
  pathname: string,
): Promise<CharacterRouteResult | null> {
  if (method !== 'GET' && method !== 'POST' && method !== 'PATCH') return null;
  const approvalMatch = APPROVE_REFERENCE.exec(pathname);
  if (approvalMatch) {
    if (method !== 'POST') return null;
    const projectId = decodeParam(approvalMatch[1] ?? '', 'project_id');
    const characterId = decodeParam(approvalMatch[2] ?? '', 'character_id');
    const referenceId = decodeParam(approvalMatch[3] ?? '', 'reference_id');
    return { status: 200, body: parseResponseContract(
      ApproveCharacterReferenceResultSchema,
      store.characterMedia.approveReference(projectId, characterId, referenceId,
        ApproveCharacterReferenceInputSchema.parse(await readJson(request))),
    ) };
  }
  const catalogMatch = CHARACTER_CATALOG.exec(pathname);
  if (catalogMatch) {
    if (method !== 'GET') return null;
    const projectId = decodeParam(catalogMatch[1] ?? '', 'project_id');
    return { status: 200, body: parseResponseContract(
      CharacterCatalogSchema, store.characters.catalog(projectId)) };
  }
  const characterMatch = CHARACTERS.exec(pathname);
  if (characterMatch) {
    const projectId = decodeParam(characterMatch[1] ?? '', 'project_id');
    if (method === 'GET') return { status: 200, body: store.characters.list(projectId) };
    if (method === 'POST') return { status: 201, body: store.characters.create(
      projectId, CreateCharacterInputSchema.parse(await readJson(request))) };
    return { status: 200, body: store.characters.update(
      projectId, UpdateCharacterInputSchema.parse(await readJson(request))) };
  }
  const referenceMatch = REFERENCES.exec(pathname);
  if (!referenceMatch) return null;
  const projectId = decodeParam(referenceMatch[1] ?? '', 'project_id');
  const characterId = decodeParam(referenceMatch[2] ?? '', 'character_id');
  if (method === 'GET') return { status: 200,
    body: store.characters.listReferences(projectId, characterId) };
  if (method === 'POST') return { status: 201,
    body: store.characters.createReference(projectId, characterId,
      CreateCharacterReferenceInputSchema.parse(await readJson(request))) };
  return { status: 200, body: store.characters.updateReference(
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
