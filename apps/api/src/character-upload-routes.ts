import { CharacterReferenceUploadResultSchema, IdSchema } from
  '@h3storyboard/protocol';
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
  if (detectImageMime(bytes) !== contentType) throw new ApiError(
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

function detectImageMime(bytes: Buffer): string | null {
  if (validatePng(bytes)) return 'image/png';
  if (validateJpeg(bytes)) return 'image/jpeg';
  if (validateWebp(bytes)) return 'image/webp';
  return null;
}

function validatePng(bytes: Buffer): boolean {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(signature)) return false;
  let offset = 8;
  let sawHeader = false;
  let sawData = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) return false;
    const type = bytes.subarray(typeStart, dataStart).toString('ascii');
    if (crc32(bytes.subarray(typeStart, dataEnd)) !==
      bytes.readUInt32BE(dataEnd)) return false;
    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13 ||
        bytes.readUInt32BE(dataStart) === 0 ||
        bytes.readUInt32BE(dataStart + 4) === 0) return false;
      sawHeader = true;
    } else if (type === 'IHDR') return false;
    if (type === 'IDAT') sawData = true;
    offset = dataEnd + 4;
    if (type === 'IEND') {
      return length === 0 && sawData && offset === bytes.length;
    }
  }
  return false;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validateJpeg(bytes: Buffer): boolean {
  if (bytes.length < 32 || bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    return false;
  }
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let sawFrame = false;
  let offset = 2;
  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++]!;
    if (marker === 0xda) return sawFrame && offset + 2 <= bytes.length - 2;
    if (marker === 0xd8 || marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length - 2) return false;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length - 2) return false;
    if (frameMarkers.has(marker)) sawFrame = true;
    offset += length;
  }
  return false;
}

function validateWebp(bytes: Buffer): boolean {
  if (bytes.length < 20 || bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    bytes.readUInt32LE(4) + 8 !== bytes.length ||
    bytes.subarray(8, 12).toString('ascii') !== 'WEBP') return false;
  let offset = 12;
  let sawImageChunk = false;
  while (offset + 8 <= bytes.length) {
    const type = bytes.subarray(offset, offset + 4).toString('ascii');
    const length = bytes.readUInt32LE(offset + 4);
    const end = offset + 8 + length;
    if (end > bytes.length) return false;
    if (['VP8 ', 'VP8L', 'VP8X', 'ANMF'].includes(type)) sawImageChunk = true;
    offset = end + (length % 2);
  }
  return sawImageChunk && offset === bytes.length;
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
