import { BatchUpsertCanvasNodesResultSchema } from '@h3storyboard/protocol';
import type { Asset, BatchUpsertCanvasNodesInput,
  BatchUpsertCanvasNodesResult, CanvasNode, Character, CreateAssetInput,
  CreateCanvasNodeInput, CreateCharacterInput, CurrentAssetsManifestSnapshot,
  UpdateAssetInput, UpdateCanvasNodeInput, UpdateCharacterInput,
} from '@h3storyboard/protocol';
import { request } from './api.js';

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
