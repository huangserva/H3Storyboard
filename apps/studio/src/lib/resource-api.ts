import { BatchUpsertCanvasNodesResultSchema } from '@h3storyboard/protocol';
import type { ApproveCharacterReferenceResult, Asset, BatchUpsertCanvasNodesInput,
  BatchUpsertCanvasNodesResult, CanvasNode, Character, CharacterReference,
  CharacterCatalog,
  CharacterImageJob,
  CharacterReferenceUploadResult,
  CreateAssetInput,
  CreateCanvasNodeInput, CreateCharacterImageJobInput, CreateCharacterInput,
  CurrentAssetsManifestSnapshot, RetryCharacterImageJobInput,
  UpdateAssetInput, UpdateCanvasNodeInput, UpdateCharacterInput,
} from '@h3storyboard/protocol';
import { ApiError, request } from './api.js';

export async function listCanvasNodes(projectId: string): Promise<CanvasNode[]> {
  return request<CanvasNode[]>(`/api/projects/${projectId}/canvas_nodes`);
}
export async function batchUpsertCanvasNodes(projectId: string,
  input: BatchUpsertCanvasNodesInput,
  signal?: AbortSignal): Promise<BatchUpsertCanvasNodesResult> {
  const result = await request<unknown>(
    `/api/projects/${encodeURIComponent(projectId)}/canvas_nodes`, {
      method: 'PUT', body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  return BatchUpsertCanvasNodesResultSchema.parse(result);
}
export async function createCanvasNode(projectId: string,
  input: CreateCanvasNodeInput): Promise<CanvasNode> {
  return request<CanvasNode>(`/api/projects/${projectId}/canvas_nodes`, {
    method: 'POST', body: JSON.stringify(input),
  });
}
export async function updateCanvasNode(projectId: string,
  input: UpdateCanvasNodeInput): Promise<CanvasNode> {
  return request<CanvasNode>(`/api/projects/${projectId}/canvas_nodes`, {
    method: 'PATCH', body: JSON.stringify(input),
  });
}
export async function listCharacters(projectId: string): Promise<Character[]> {
  return request<Character[]>(`/api/projects/${projectId}/characters`);
}
export async function createCharacter(projectId: string,
  input: CreateCharacterInput): Promise<Character> {
  return request<Character>(`/api/projects/${projectId}/characters`, {
    method: 'POST', body: JSON.stringify(input),
  });
}
export async function updateCharacter(projectId: string,
  input: UpdateCharacterInput): Promise<Character> {
  return request<Character>(`/api/projects/${projectId}/characters`, {
    method: 'PATCH', body: JSON.stringify(input),
  });
}
export async function listCharacterReferences(projectId: string,
  characterId: string): Promise<CharacterReference[]> {
  return request<CharacterReference[]>(`/api/projects/${encodeURIComponent(projectId)}` +
    `/characters/${encodeURIComponent(characterId)}/references`);
}
export async function getCharacterCatalog(projectId: string,
  signal?: AbortSignal): Promise<CharacterCatalog> {
  return request<CharacterCatalog>(`/api/projects/${encodeURIComponent(projectId)}` +
    '/character_catalog', signal ? { signal } : undefined);
}
export async function uploadCharacterReference(projectId: string,
  characterId: string, file: File,
  derivedFrom: string | null = null): Promise<CharacterReferenceUploadResult> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}` +
    `/characters/${encodeURIComponent(characterId)}/reference_uploads`, {
      method: 'POST',
      headers: {
        'content-type': file.type,
        'x-file-name': file.name,
        'x-idempotency-key': crypto.randomUUID(),
        ...(derivedFrom ? { 'x-derived-from-reference-id': derivedFrom } : {}),
      },
      body: file,
    });
  return parseRawResponse<CharacterReferenceUploadResult>(response);
}
export async function approveCharacterReference(projectId: string,
  characterId: string, referenceId: string,
  makePrimary = true): Promise<ApproveCharacterReferenceResult> {
  return request<ApproveCharacterReferenceResult>(
    `/api/projects/${encodeURIComponent(projectId)}/characters/` +
    `${encodeURIComponent(characterId)}/references/` +
    `${encodeURIComponent(referenceId)}/approve`, {
      method: 'POST', body: JSON.stringify({ make_primary: makePrimary }),
    });
}
export async function archiveCharacterReferenceAsset(projectId: string,
  assetId: string): Promise<Asset> {
  return updateAsset(projectId, { asset_id: assetId, status: 'archived' });
}
export async function listCharacterImageJobs(projectId: string,
  signal?: AbortSignal): Promise<CharacterImageJob[]> {
  return request<CharacterImageJob[]>(`/api/projects/${encodeURIComponent(projectId)}` +
    '/character_image_jobs', signal ? { signal } : undefined);
}
export async function createCharacterImageJob(projectId: string,
  characterId: string,
  input: CreateCharacterImageJobInput): Promise<CharacterImageJob> {
  const { engine: _serverSelectedEngine, provider: _serverSelectedProvider,
    ...requestInput } = input;
  return request<CharacterImageJob>(`/api/projects/${encodeURIComponent(projectId)}` +
    `/characters/${encodeURIComponent(characterId)}/image_jobs`, {
      method: 'POST', body: JSON.stringify(requestInput),
    });
}
export async function retryCharacterImageJob(projectId: string, jobId: string,
  input: RetryCharacterImageJobInput): Promise<CharacterImageJob> {
  return request<CharacterImageJob>(`/api/projects/${encodeURIComponent(projectId)}` +
    `/character_image_jobs/${encodeURIComponent(jobId)}/retry`, {
      method: 'POST', body: JSON.stringify(input),
    });
}
export async function cancelCharacterImageJob(projectId: string,
  jobId: string, reason: string): Promise<CharacterImageJob> {
  return request<CharacterImageJob>(`/api/projects/${encodeURIComponent(projectId)}` +
    `/character_image_jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST', body: JSON.stringify({ reason }),
    });
}
export async function listAssets(projectId: string): Promise<Asset[]> {
  return request<Asset[]>(`/api/projects/${projectId}/assets`);
}
export async function createAsset(projectId: string,
  input: CreateAssetInput): Promise<Asset> {
  return request<Asset>(`/api/projects/${projectId}/assets`, {
    method: 'POST', body: JSON.stringify(input),
  });
}
export async function updateAsset(projectId: string,
  input: UpdateAssetInput): Promise<Asset> {
  return request<Asset>(`/api/projects/${projectId}/assets`, {
    method: 'PATCH', body: JSON.stringify(input),
  });
}
export async function listAssetManifests(projectId: string) {
  return request<CurrentAssetsManifestSnapshot[]>(
    `/api/projects/${projectId}/manifests`);
}
export async function freezeAssetManifest(projectId: string) {
  return request<CurrentAssetsManifestSnapshot>(
    `/api/projects/${projectId}/manifests`, { method: 'POST' });
}

async function parseRawResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as { data?: T; error?: {
    code?: string; message?: string } };
  if (!response.ok || body.data === undefined) {
    throw new ApiError(body.error?.code ?? 'HTTP_ERROR', response.status,
      body.error?.message ?? '请求失败');
  }
  return body.data;
}
