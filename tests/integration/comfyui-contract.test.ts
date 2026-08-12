import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ComfyUIClient,
  REQUIRED_H3_NODES,
  discoverCapabilities,
} from '../../packages/h3-provider/src/index.js';

interface StubState {
  historyCalls: number;
  promptBody?: unknown;
  route?: 'success' | 'submit-error' | 'timeout' | 'empty-output' | 'empty-download';
}

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve, reject) => server.close((error) =>
      error ? reject(error) : resolve()))));
});

async function stubComfy(state: StubState) {
  const server = createServer(async (request, response) => {
    await handleStub(request, response, state);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  return `http://127.0.0.1:${address.port}`;
}

async function handleStub(request: IncomingMessage, response: ServerResponse,
  state: StubState) {
  const path = request.url ?? '';
  if (path === '/upload/image') {
    expect(request.headers['content-type']).toContain('multipart/form-data');
    await readBody(request);
    return json(response, 200, { name: 'start.png', subfolder: 'h3' });
  }
  if (path === '/prompt') {
    state.promptBody = JSON.parse((await readBody(request)).toString());
    if (state.route === 'submit-error') return json(response, 400, { error: 'bad graph' });
    return json(response, 200, { prompt_id: 'pid-1', node_errors: {} });
  }
  if (path === '/history/pid-1') {
    state.historyCalls += 1;
    if (state.route === 'timeout' || state.historyCalls === 1) return json(response, 200, {});
    if (state.route === 'empty-output') return json(response, 200, {
      'pid-1': { status: { completed: true }, outputs: {} },
    });
    return json(response, 200, { 'pid-1': { status: { completed: true },
      outputs: { '7': { videos: [{ filename: 'result.mp4', subfolder: 'h3',
        type: 'output' }] } } } });
  }
  if (path.startsWith('/view?')) {
    response.writeHead(200, { 'content-type': 'video/mp4' });
    return response.end(state.route === 'empty-download' ? Buffer.alloc(0) : Buffer.from([1, 2, 3]));
  }
  if (path === '/free') return json(response, 200, { ok: true });
  if (path === '/object_info') return json(response, 200,
    Object.fromEntries(REQUIRED_H3_NODES.slice(0, -1).map((node) => [node, {}])));
  return json(response, 404, { error: 'not found' });
}

describe('ComfyUI HTTP contract', () => {
  it('crosses upload, submit, poll, output selection, download, and free', async () => {
    const state: StubState = { historyCalls: 0, route: 'success' };
    const endpoint = await stubComfy(state);
    const client = new ComfyUIClient({ endpoint, poll_interval_ms: 0,
      poll_max_attempts: 2, client_id_factory: () => 'client-1' });

    expect(await client.uploadImage(new Blob([new Uint8Array([9])]), 'start.png'))
      .toBe('h3/start.png');
    expect(await client.submitPrompt({ '1': { class_type: 'Test', inputs: {} } }))
      .toBe('pid-1');
    expect(state.promptBody).toEqual({ prompt: { '1': { class_type: 'Test',
      inputs: {} } }, client_id: 'client-1' });
    const history = await client.pollHistory('pid-1');
    const output = client.firstOutput(history);
    expect(client.viewUrl(output)).toContain('filename=result.mp4');
    expect(await client.downloadOutput(output)).toEqual(new Uint8Array([1, 2, 3]));
    await expect(client.free()).resolves.toBeUndefined();
  });

  it('maps submit HTTP failures to a stable contract error', async () => {
    const endpoint = await stubComfy({ historyCalls: 0, route: 'submit-error' });
    await expect(new ComfyUIClient({ endpoint }).submitPrompt({})).rejects
      .toMatchObject({ code: 'H3_COMFY_HTTP_ERROR' });
  });

  it('times out when history never contains the prompt', async () => {
    const endpoint = await stubComfy({ historyCalls: 0, route: 'timeout' });
    const client = new ComfyUIClient({ endpoint, poll_interval_ms: 0,
      poll_max_attempts: 2 });
    await expect(client.pollHistory('pid-1')).rejects.toMatchObject({
      code: 'H3_COMFY_TIMEOUT',
    });
  });

  it('rejects completed history without outputs', async () => {
    const endpoint = await stubComfy({ historyCalls: 1, route: 'empty-output' });
    const client = new ComfyUIClient({ endpoint, poll_interval_ms: 0,
      poll_max_attempts: 1 });
    await expect(client.pollHistory('pid-1')).rejects.toMatchObject({
      code: 'H3_COMFY_OUTPUT_MISSING',
    });
  });

  it('rejects an empty downloaded output', async () => {
    const endpoint = await stubComfy({ historyCalls: 0, route: 'empty-download' });
    const client = new ComfyUIClient({ endpoint });
    await expect(client.downloadOutput({ filename: 'empty.mp4', subfolder: '',
      type: 'output' })).rejects.toMatchObject({ code: 'H3_COMFY_EMPTY_DOWNLOAD' });
  });

  it('reports a per-node present/missing capability evidence map', async () => {
    const endpoint = await stubComfy({ historyCalls: 0 });
    const evidence = await discoverCapabilities(endpoint);
    expect(evidence.ready).toBe(false);
    expect(evidence.nodes[REQUIRED_H3_NODES.at(-1)!]).toBe('missing');
    expect(evidence.nodes.MiniMaxH3Director).toBe('present');
  });
});

const probe = process.env.H3_COMFY_PROBE === '1' ? it : it.skip;
probe('read-only probes the local H3 ComfyUI capability contract', async () => {
  const evidence = await discoverCapabilities('http://127.0.0.1:8190');
  expect(evidence.ready).toBe(true);
  expect(evidence.nodes.MiniMaxH3Director).toBe('present');
  expect(evidence.nodes.MiniMaxH3ReferenceToVideo).toBe('present');
  expect(evidence.nodes.SamplerCustomAdvanced).toBe('present');
});

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}
