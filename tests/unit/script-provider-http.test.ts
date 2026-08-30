import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { postJsonWithLimit, ProviderResponseTooLargeError } from
  '../../apps/api/src/script-generation-http.js';

const servers = new Set<Server>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise<void>(
    (resolve, reject) => server.close((error) => error ? reject(error) : resolve()),
  )));
  servers.clear();
});

describe('script provider HTTP transport', () => {
  it('waits for response headers until the caller timeout', async () => {
    const origin = await startDelayedProvider(80);
    const response = await postJsonWithLimit(
      `${origin}/v1/chat/completions`,
      { model: 'slow-local-model', messages: [] },
      { signal: AbortSignal.timeout(500), max_body_bytes: 1_000_000 },
    );

    expect(response).toMatchObject({ status: 200, body: '{"ok":true}' });
  });

  it('aborts while waiting for response headers at the caller timeout',
    async () => {
      const origin = await startDelayedProvider(80);

      await expect(postJsonWithLimit(
        `${origin}/v1/chat/completions`,
        { model: 'slow-local-model', messages: [] },
        { signal: AbortSignal.timeout(20), max_body_bytes: 1_000_000 },
      )).rejects.toMatchObject({ name: 'AbortError' });
    });

  it('forwards the configured bearer authorization header', async () => {
    let authorization: string | undefined;
    const origin = await startProvider(async (request, response) => {
      authorization = request.headers.authorization;
      for await (const _chunk of request) {
        // Consume the real request before responding.
      }
      response.writeHead(200).end('{}');
    });

    await postJsonWithLimit(`${origin}/v1/chat/completions`, {}, {
      signal: AbortSignal.timeout(500),
      max_body_bytes: 1_000_000,
      authorization: 'Bearer integration-secret',
    });

    expect(authorization).toBe('Bearer integration-secret');
  });

  it('rejects a declared response length before reading the body', async () => {
    const origin = await startProvider(async (request, response) => {
      for await (const _chunk of request) {
        // Consume the real request before responding.
      }
      response.writeHead(200, { 'content-length': '1000001' }).end('x');
    });

    await expect(postJsonWithLimit(
      `${origin}/v1/chat/completions`, {},
      { signal: AbortSignal.timeout(500), max_body_bytes: 1_000_000 },
    )).rejects.toBeInstanceOf(ProviderResponseTooLargeError);
  });
});

async function startDelayedProvider(delayMs: number): Promise<string> {
  return startProvider(async (request, response) => {
    for await (const _chunk of request) {
      // Consume the real request body before delaying response headers.
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (response.destroyed) return;
    const body = '{"ok":true}';
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    }).end(body);
  });
}

async function startProvider(handler: (request: IncomingMessage,
  response: ServerResponse) => Promise<void>): Promise<string> {
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  servers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error(
    'Delayed provider did not obtain a TCP address');
  return `http://127.0.0.1:${address.port}`;
}
