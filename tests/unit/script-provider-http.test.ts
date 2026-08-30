import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { postJsonWithLimit } from
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
});

async function startDelayedProvider(delayMs: number): Promise<string> {
  const server = createServer(async (request, response) => {
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
