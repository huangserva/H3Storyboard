import {
  CreateAssetInputSchema,
  UpdateAssetInputSchema,
} from '@h3storyboard/protocol';
import type { ProjectStore } from '@h3storyboard/project-store';
import type { IncomingMessage } from 'node:http';
import { ApiError } from './api-error.js';
import { readJson } from './http.js';

interface AssetRouteResult { status: number; body: unknown }

const ASSETS = /^\/api\/projects\/([^/]+)\/assets$/;
const MANIFESTS = /^\/api\/projects\/([^/]+)\/manifests$/;
const MANIFEST_VERSION = /^\/api\/projects\/([^/]+)\/manifests\/([^/]+)$/;

export async function dispatchAssetRoute(request: IncomingMessage,
  store: ProjectStore, method: string,
  pathname: string): Promise<AssetRouteResult | null> {
  if (method !== 'GET' && method !== 'POST' && method !== 'PATCH') return null;
  const assets = ASSETS.exec(pathname);
  if (assets) {
    const projectId = decodeParam(assets[1] ?? '', 'project_id');
    if (method === 'GET') return { status: 200, body: store.listAssets(projectId) };
    if (method === 'POST') return { status: 201, body: store.createAsset(projectId,
      CreateAssetInputSchema.parse(await readJson(request))) };
    return { status: 200, body: store.updateAsset(projectId,
      UpdateAssetInputSchema.parse(await readJson(request))) };
  }
  const manifests = MANIFESTS.exec(pathname);
  if (manifests) {
    const projectId = decodeParam(manifests[1] ?? '', 'project_id');
    if (method === 'GET') return { status: 200,
      body: store.listCurrentAssetsManifests(projectId) };
    if (method === 'POST') return { status: 201,
      body: store.freezeCurrentAssetsManifest(projectId) };
    return null;
  }
  const versionMatch = MANIFEST_VERSION.exec(pathname);
  if (!versionMatch || method !== 'GET') return null;
  const projectId = decodeParam(versionMatch[1] ?? '', 'project_id');
  const version = Number(decodeParam(versionMatch[2] ?? '', 'manifest_version'));
  if (!Number.isInteger(version) || version <= 0) throw new ApiError(
    400, 'MANIFEST_VERSION_INVALID', 'manifest_version must be a positive integer');
  return { status: 200, body: store.getCurrentAssetsManifest(projectId, version) };
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
