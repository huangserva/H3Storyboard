import type { ProjectStore } from '@h3storyboard/project-store';
import { RelativeAssetPathSchema } from '@h3storyboard/protocol';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { ApiError } from './api-error.js';

const ASSET_FILE = /^\/api\/assets\/([^/]+)\/file$/;

export async function serveMediaRoute(request: IncomingMessage,
  response: ServerResponse, store: ProjectStore,
  dataDirectory: string): Promise<boolean> {
  if (request.method !== 'GET') return false;
  const match = ASSET_FILE.exec(new URL(request.url ?? '/', 'http://localhost').pathname);
  if (!match) return false;
  const assetId = decodeParam(match[1] ?? '');
  const asset = store.getAsset(assetId);
  const parsed = RelativeAssetPathSchema.safeParse(asset.relative_path);
  const root = resolve(dataDirectory);
  if (!parsed.success) throw invalidPath(assetId);
  const filePath = resolve(root, parsed.data);
  if (!filePath.startsWith(`${root}${sep}`)) throw invalidPath(assetId);
  let canonicalPath: string;
  let size: number;
  try {
    const [canonicalRoot, resolvedFile] = await Promise.all([
      realpath(root), realpath(filePath),
    ]);
    if (!resolvedFile.startsWith(`${canonicalRoot}${sep}`)) {
      throw invalidPath(assetId);
    }
    canonicalPath = resolvedFile;
    const info = await stat(canonicalPath);
    if (!info.isFile()) throw new Error('not a file');
    size = info.size;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(404, 'ASSET_FILE_NOT_FOUND',
      'Asset file does not exist on disk', { asset_id: assetId });
  }
  const range = parseRange(request.headers.range, size);
  const headers: Record<string, string | number> = {
    'accept-ranges': 'bytes',
    'content-type': contentType(filePath),
    'cache-control': 'private, max-age=0, must-revalidate',
  };
  if (range) {
    headers['content-range'] = `bytes ${range.start}-${range.end}/${size}`;
    headers['content-length'] = range.end - range.start + 1;
    response.writeHead(206, headers);
  } else {
    headers['content-length'] = size;
    response.writeHead(200, headers);
  }
  await pipeFile(canonicalPath, response, range);
  return true;
}

function parseRange(header: string | undefined, size: number) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) throw rangeError(size);
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[2] && match[1] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
    start < 0 || start >= size || end < start) throw rangeError(size);
  end = Math.min(end, size - 1);
  return { start, end };
}

function pipeFile(path: string, response: ServerResponse,
  range: { start: number; end: number } | null) {
  return new Promise<void>((resolvePipe, reject) => {
    const stream = createReadStream(path, range ?? undefined);
    let settled = false;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      stream.removeListener('error', onError);
      response.removeListener('finish', onFinish);
      response.removeListener('close', onClose);
      if (error) reject(error); else resolvePipe();
    };
    const onError = (error: Error) => settle(error);
    const onFinish = () => settle();
    const onClose = () => {
      stream.unpipe(response);
      stream.destroy();
      settle();
    };
    stream.once('error', onError);
    response.once('finish', onFinish);
    response.once('close', onClose);
    stream.pipe(response);
  });
}

function contentType(path: string): string {
  return ({ '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.gif': 'image/gif', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4' } as Record<string, string>)[extname(path).toLowerCase()]
    ?? 'application/octet-stream';
}

function decodeParam(value: string): string {
  try { const decoded = decodeURIComponent(value); if (decoded) return decoded; }
  catch { /* stable route error below */ }
  throw new ApiError(400, 'ROUTE_PARAMETER_INVALID', 'asset_id is invalid');
}

function invalidPath(assetId: string) {
  return new ApiError(422, 'ASSET_FILE_PATH_INVALID',
    'Asset file path escapes the project data directory', { asset_id: assetId });
}

function rangeError(size: number) {
  return new ApiError(416, 'ASSET_RANGE_INVALID',
    'Requested asset byte range is not satisfiable', { size });
}
