import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export class ProviderResponseTooLargeError extends Error {
  constructor() {
    super('Provider response exceeded the configured byte limit');
    this.name = 'ProviderResponseTooLargeError';
  }
}

export interface ProviderHttpResponse {
  readonly status: number;
  readonly body: string;
}

interface PostJsonOptions {
  readonly signal: AbortSignal;
  readonly max_body_bytes: number;
  readonly authorization?: string;
}

export async function postJsonWithLimit(
  rawUrl: string,
  payload: unknown,
  options: PostJsonOptions,
): Promise<ProviderHttpResponse> {
  const url = new URL(rawUrl);
  const body = Buffer.from(JSON.stringify(payload));
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<ProviderHttpResponse>((resolve, reject) => {
    const outgoing = request(url, {
      method: 'POST',
      signal: options.signal,
      headers: {
        'content-type': 'application/json',
        'content-length': body.byteLength,
        ...(options.authorization
          ? { authorization: options.authorization } : {}),
      },
    }, (incoming) => {
      const declared = Number(incoming.headers['content-length']);
      if (Number.isFinite(declared) && declared > options.max_body_bytes) {
        incoming.destroy();
        reject(new ProviderResponseTooLargeError());
        return;
      }
      void readBody(incoming, options.max_body_bytes).then((responseBody) => {
        resolve({ status: incoming.statusCode ?? 0, body: responseBody });
      }, reject);
    });
    outgoing.once('error', reject);
    outgoing.end(body);
  });
}

async function readBody(
  incoming: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of incoming) {
    const bytes = Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > maxBytes) {
      if ('destroy' in incoming && typeof incoming.destroy === 'function') {
        incoming.destroy();
      }
      throw new ProviderResponseTooLargeError();
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}
