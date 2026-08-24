import { CharacterReferenceUploadResultSchema, IdSchema } from
  '@h3storyboard/protocol';
import { CharacterImageValidationError, decodeCharacterImage } from
  '@h3storyboard/h3-provider';
import type { ProjectStore } from '@h3storyboard/project-store';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, join, resolve, sep } from 'node:path';
import { ApiError, parseResponseContract } from './api-error.js';
import { sendJson } from './http.js';

const REFERENCE_UPLOAD =
  /^\/api\/projects\/([^/]+)\/characters\/([^/]+)\/reference_uploads$/;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export async function serveCharacterUploadRoute(
  request: IncomingMessage,
  response: ServerResponse,
  store: ProjectStore,
  dataDirectory: string,
): Promise<boolean> {
  if (request.method !== 'POST') return false;
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  const match = REFERENCE_UPLOAD.exec(pathname);
  if (!match) return false;
  const projectId = decodeId(match[1] ?? '', 'project_id');
  const characterId = decodeId(match[2] ?? '', 'character_id');
  const contentType = singleHeader(request, 'content-type').split(';')[0]!.trim();
  const extension = extensionByMime[contentType];
  if (!extension) throw new ApiError(415, 'CHARACTER_IMAGE_TYPE_UNSUPPORTED',
    'Character references must be PNG, JPEG, or WebP');
  const originalName = validateFileName(singleHeader(request, 'x-file-name'));
  const idempotencyKey = requiredHeader(request, 'x-idempotency-key', 200);
  const derivedFrom = optionalIdHeader(request, 'x-derived-from-reference-id');
  const bytes = await readImageBody(request);
  let decoded;
  try {
    decoded = await decodeCharacterImage(bytes);
  } catch (error) {
    if (error instanceof CharacterImageValidationError) throw new ApiError(
      422, error.code, error.message);
    throw error;
  }
  if (decoded.mime_type !== contentType) throw new ApiError(
    422, 'CHARACTER_IMAGE_INVALID',
    'Uploaded bytes do not match the declared image type');
  const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const requestHash = `sha256:${createHash('sha256').update(
    `${contentHash}\n${derivedFrom ?? ''}`).digest('hex')}`;
  const relativePath = join('assets', 'characters', projectId,
    `${randomUUID()}.${extension}`);
  const outputPath = await secureOutputPath(dataDirectory, relativePath);
  const tempPath = `${outputPath}.${randomUUID()}.upload`;
  try {
    await writeFile(tempPath, bytes, { flag: 'wx', mode: 0o600 });
    await rename(tempPath, outputPath);
  } catch (error) {
    await Promise.all([
      unlink(tempPath).catch(() => undefined),
      unlink(outputPath).catch(() => undefined),
    ]);
    throw error;
  }
  let result;
  try {
    result = store.characterMedia.registerUpload(projectId, characterId, {
      idempotency_key: idempotencyKey,
      request_hash: requestHash,
      name: originalName,
      relative_path: relativePath,
      content_hash: contentHash,
      derived_from: derivedFrom,
    });
  } catch (error) {
    await unlink(outputPath).catch(() => undefined);
    throw error;
  }
  if (result.replayed) await unlink(outputPath).catch(() => undefined);
  const body = parseResponseContract(CharacterReferenceUploadResultSchema, result);
  sendJson(response, result.replayed ? 200 : 201, { data: body });
  return true;
}

const extensionByMime: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

async function readImageBody(request: IncomingMessage): Promise<Buffer> {
  const length = Number(request.headers['content-length']);
  if (Number.isFinite(length) && length > MAX_IMAGE_BYTES) throw new ApiError(
    413, 'CHARACTER_IMAGE_TOO_LARGE', 'Character image exceeds 15 MiB');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_IMAGE_BYTES) throw new ApiError(
      413, 'CHARACTER_IMAGE_TOO_LARGE', 'Character image exceeds 15 MiB');
    chunks.push(buffer);
  }
  if (size === 0) throw new ApiError(400, 'CHARACTER_IMAGE_REQUIRED',
    'Character image body is required');
  return Buffer.concat(chunks);
}

async function secureOutputPath(rootPath: string, relativePath: string) {
  const root = resolve(rootPath);
  const directory = resolve(root, 'assets', 'characters',
    relativePath.split(sep).at(-2)!);
  await mkdir(directory, { recursive: true });
  const [canonicalRoot, canonicalDirectory] = await Promise.all([
    realpath(root), realpath(directory),
  ]);
  if (!canonicalDirectory.startsWith(`${canonicalRoot}${sep}`)) {
    throw new ApiError(422, 'ASSET_FILE_PATH_INVALID',
      'Character upload path escapes the project data directory');
  }
  return join(canonicalDirectory, basename(relativePath));
}

function validateFileName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 240 || basename(name) !== name || /[\\/]/.test(name)) {
    throw new ApiError(400, 'CHARACTER_IMAGE_NAME_INVALID',
      'x-file-name must be a plain file name of at most 240 characters');
  }
  return name;
}

function optionalIdHeader(request: IncomingMessage, name: string): string | null {
  const value = singleHeader(request, name).trim();
  if (!value) return null;
  const parsed = IdSchema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'ROUTE_PARAMETER_INVALID',
    `${name} must be a UUID`);
  return parsed.data;
}

function requiredHeader(request: IncomingMessage, name: string,
  maxLength: number): string {
  const value = singleHeader(request, name).trim();
  if (!value || value.length > maxLength) throw new ApiError(
    400, 'CHARACTER_UPLOAD_HEADER_INVALID',
    `${name} is required and must be at most ${maxLength} characters`);
  return value;
}

function singleHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function decodeId(value: string, name: string): string {
  try {
    const parsed = IdSchema.safeParse(decodeURIComponent(value));
    if (parsed.success) return parsed.data;
  } catch { /* stable route error below */ }
  throw new ApiError(400, 'ROUTE_PARAMETER_INVALID', `${name} is invalid`);
}
