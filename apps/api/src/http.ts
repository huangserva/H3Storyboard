import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError } from './api-error.js';

const MAX_JSON_BODY_BYTES = 1_000_000;

export async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BODY_BYTES) {
      throw new ApiError(
        413,
        'PAYLOAD_TOO_LARGE',
        'JSON request body exceeds 1 MB',
      );
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    throw new ApiError(400, 'JSON_BODY_REQUIRED', 'A JSON body is required');
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  }
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  const json = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
    'cache-control': 'no-store',
  });
  response.end(json);
}
