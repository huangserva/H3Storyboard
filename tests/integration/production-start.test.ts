import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { seedCanvasDemo } from '../../scripts/canvas-demo-fixture.js';

const children = new Set<ChildProcess>();
const directories = new Set<string>();
const httpServers = new Set<Server>();
const repositoryRoot = resolve(import.meta.dirname, '../..');

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  children.clear();
  await Promise.all([...httpServers].map((server) => new Promise<void>(
    (resolveClose, reject) => server.close((error) =>
      error ? reject(error) : resolveClose()))));
  httpServers.clear();
  await Promise.all(
    [...directories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  directories.clear();
});

describe('compiled API runtime', () => {
  it('starts the built Node entrypoint with dist package exports', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'h3-production-start-'));
    directories.add(directory);
    const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        H3_STORYBOARD_DB: join(directory, 'production.db'),
        H3_STORYBOARD_PORT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    const origin = await waitForOrigin(child);
    const response = await fetch(`${origin}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { status: 'ok', protocol_version: '1.8' },
    });

    child.kill('SIGTERM');
    expect(await waitForExit(child)).toBe(0);
    children.delete(child);
  });

  it('keeps a draft demo job offline when H3_WORKER is zero', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'h3-demo-offline-start-'));
    directories.add(directory);
    const databasePath = join(directory, 'canvas-test.db');
    const fixture = await seedCanvasDemo({ database_path: databasePath });
    const sentinel = await startSentinel();
    const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
      cwd: repositoryRoot,
      env: { ...process.env, H3_STORYBOARD_DB: databasePath,
        H3_STORYBOARD_PORT: '0', H3_WORKER: '0',
        H3_COMFY_ENDPOINT: sentinel.origin, H3_WORKER_IDLE_MS: '25' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    const origin = await waitForOrigin(child);
    const preflightResponse = await fetch(`${origin}/api/projects/${fixture.project_id}` +
      `/shots/${fixture.shot_ids[0]}/jobs/preflight`);
    const preflight = (await preflightResponse.json() as { data: {
      ready: boolean; mode: string; input_bindings: unknown[] } }).data;
    expect(preflight.ready).toBe(true);
    const idempotencyKey = `offline-${crypto.randomUUID()}`;
    const created = await fetch(`${origin}/api/projects/${fixture.project_id}` +
      `/shots/${fixture.shot_ids[0]}/jobs`, { method: 'POST', headers: {
        'content-type': 'application/json' }, body: JSON.stringify({
        mode: preflight.mode, provider: 'local_comfyui', model: 'offline-test',
        prompt: 'Offline canvas startup must not submit this H3 job.',
        duration_seconds: 10.125, seed: 419, steps: 28, audio_mode: 'silent',
        idempotency_key: idempotencyKey, input_bindings: preflight.input_bindings,
      }) });
    expect(created.status).toBe(201);
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    expect(sentinel.requests()).toBe(0);
    const snapshot = await fetch(
      `${origin}/api/projects/${fixture.project_id}`).then((response) =>
      response.json() as Promise<{ data: { h3_jobs: Array<{
        idempotency_key: string; status: string }> } }>);
    expect(snapshot.data.h3_jobs.find(({ idempotency_key }) =>
      idempotency_key === idempotencyKey)?.status).toBe('draft');

    child.kill('SIGTERM');
    expect(await waitForExit(child)).toBe(0);
    children.delete(child);
  });

  it('runs the compiled character-image worker through HTTP and SQLite',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'h3-image-runtime-start-'));
      directories.add(directory);
      const databasePath = join(directory, 'runtime.db');
      const comfy = await startImageComfy();
      const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
        cwd: repositoryRoot,
        env: { ...process.env, H3_STORYBOARD_DB: databasePath,
          H3_STORYBOARD_PORT: '0', H3_VIDEO_WORKER: '0',
          H3_IMAGE_WORKER: '1', H3_IMAGE_COMFY_ENDPOINT: comfy.origin,
          H3_COMFY_ENDPOINT: comfy.origin, H3_GPU_MIN_FREE_GIB: '0.001',
          H3_IMAGE_WORKER_IDLE_MS: '10', H3_IMAGE_WORKER_POLL_MS: '1',
          H3_IMAGE_WORKER_POLL_ATTEMPTS: '100',
          H3_GPU_SETTLE_MS: '0', H3_MANAGED_COMFY_ENDPOINTS: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      children.add(child);
      const origin = await waitForOrigin(child);
      const project = await postData(origin, '/api/projects', {
        title: 'Runtime image project', script_title: 'Runtime image script',
        script_content: 'A real main-process image worker integration test.',
      });
      const character = await postData(origin,
        `/api/projects/${project.id}/characters`, {
          name: 'Runtime actor', canonical_appearance:
            'An adult actor with stable face, hair, and wardrobe.',
        });
      const job = await postData(origin,
        `/api/projects/${project.id}/characters/${character.id}/image_jobs`, {
          operation: 'master_t2i', prompt: 'Neutral cinematic master portrait.',
          seed: 2026082402, width: 480, height: 864, steps: 8, cfg: 1,
          sampler: 'euler_ancestral', scheduler: 'sgm_uniform', denoise: null,
          lora_profile: null, lora_name: null, lora_strength: null,
          source_reference_ids: [],
          idempotency_key: `runtime-image-${crypto.randomUUID()}`,
        });

      const completed = await waitForImageJob(origin, project.id, job.id);
      expect(completed).toMatchObject({ status: 'completed',
        provider_job_id: 'runtime-image-prompt' });
      const snapshot = await fetch(`${origin}/api/projects/${project.id}`)
        .then((response) => response.json() as Promise<{ data: {
          assets: Array<{ id: string; kind: string; status: string;
            producer_image_job_id: string | null }>; } }>);
      expect(snapshot.data.assets).toContainEqual(expect.objectContaining({
        id: completed.output_asset_id, kind: 'image', status: 'candidate',
        producer_image_job_id: job.id,
      }));
      expect(comfy.submissions()).toBe(1);
      expect(comfy.classTypes()).toEqual(expect.arrayContaining([
        'UNETLoader', 'KSampler', 'SaveImage',
      ]));

      child.kill('SIGTERM');
      expect(await waitForExit(child)).toBe(0);
      children.delete(child);
    });

  it('cancels the active provider prompt through the compiled API runtime',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'h3-image-cancel-start-'));
      directories.add(directory);
      const comfy = await startImageComfy({ complete: false });
      const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
        cwd: repositoryRoot,
        env: { ...process.env, H3_STORYBOARD_DB: join(directory, 'runtime.db'),
          H3_STORYBOARD_PORT: '0', H3_VIDEO_WORKER: '0',
          H3_IMAGE_WORKER: '1', H3_IMAGE_COMFY_ENDPOINT: comfy.origin,
          H3_COMFY_ENDPOINT: comfy.origin, H3_GPU_MIN_FREE_GIB: '0.001',
          H3_IMAGE_WORKER_IDLE_MS: '10', H3_IMAGE_WORKER_POLL_MS: '5',
          H3_IMAGE_WORKER_POLL_ATTEMPTS: '1000', H3_GPU_SETTLE_MS: '0',
          H3_MANAGED_COMFY_ENDPOINTS: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      children.add(child);
      const origin = await waitForOrigin(child);
      const project = await postData(origin, '/api/projects', {
        title: 'Cancel image project', script_title: 'Cancel image script',
        script_content: 'Cancel a live provider task from the compiled runtime.',
      });
      const character = await postData(origin,
        `/api/projects/${project.id}/characters`, {
          name: 'Cancel actor', canonical_appearance: 'Stable adult actor.',
        });
      const job = await postData(origin,
        `/api/projects/${project.id}/characters/${character.id}/image_jobs`, {
          operation: 'master_t2i', prompt: 'Cancelable master portrait.',
          seed: 2026082403, width: 480, height: 864, steps: 8, cfg: 1,
          sampler: 'euler_ancestral', scheduler: 'sgm_uniform', denoise: null,
          lora_profile: null, lora_name: null, lora_strength: null,
          source_reference_ids: [],
          idempotency_key: `runtime-cancel-${crypto.randomUUID()}`,
        });
      await waitForImageJobStatus(origin, project.id, job.id, 'running');

      const canceled = await postData(origin,
        `/api/projects/${project.id}/character_image_jobs/${job.id}/cancel`, {
          reason: 'Director canceled the active provider render.',
        });
      expect(canceled).toMatchObject({ status: 'canceled',
        cancel_reason: 'Director canceled the active provider render.' });
      expect(comfy.interrupts()).toBe(1);
      await waitForImageJobStatus(origin, project.id, job.id, 'canceled');

      child.kill('SIGTERM');
      expect(await waitForExit(child)).toBe(0);
      children.delete(child);
    });
});

async function startSentinel(): Promise<{ origin: string; requests: () => number }> {
  let requestCount = 0;
  const server = createServer((_request, response) => {
    requestCount += 1;
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'worker must stay disabled' }));
  });
  httpServers.add(server);
  await new Promise<void>((resolveListen) =>
    server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('sentinel unavailable');
  return { origin: `http://127.0.0.1:${address.port}`,
    requests: () => requestCount };
}

async function startImageComfy(options: { complete?: boolean } = {}): Promise<{
  origin: string; submissions: () => number; classTypes: () => string[];
  interrupts: () => number }> {
  let submissions = 0;
  let interrupts = 0;
  let active = false;
  let submittedClassTypes: string[] = [];
  const requiredNodes = ['UNETLoader', 'CLIPLoader', 'VAELoader',
    'CLIPTextEncode', 'ConditioningZeroOut', 'EmptyLatentImage', 'KSampler',
    'VAEDecode', 'SaveImage'];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/queue') return json(response, {
      queue_running: active ? [[0, 'runtime-image-prompt', {}, {}]] : [],
      queue_pending: [],
    });
    if (url.pathname === '/system_stats') return json(response, { devices: [{
      name: 'NVIDIA RTX 4090', type: 'cuda',
      vram_total: 48 * 1024 ** 3, vram_free: 32 * 1024 ** 3,
    }] });
    if (url.pathname === '/object_info') return json(response,
      Object.fromEntries(requiredNodes.map((node) => [node, {}])));
    if (url.pathname === '/prompt' && request.method === 'POST') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => { body += chunk; });
      request.on('end', () => {
        const parsed = JSON.parse(body) as { prompt: Record<string, {
          class_type?: string }> };
        submittedClassTypes = Object.values(parsed.prompt)
          .flatMap(({ class_type }) => class_type ? [class_type] : []);
        submissions += 1;
        active = true;
        json(response, { prompt_id: 'runtime-image-prompt', node_errors: {} });
      });
      return;
    }
    if (url.pathname === '/history/runtime-image-prompt') return json(response,
      options.complete === false ? {} : {
        'runtime-image-prompt': { status: { completed: true }, outputs: {
          save: { images: [{ filename: 'runtime.png', type: 'output' }] },
        } },
      });
    if (url.pathname === '/interrupt' && request.method === 'POST') {
      interrupts += 1;
      active = false;
      return json(response, {});
    }
    if (url.pathname === '/view') {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(PNG_1X1);
      return;
    }
    response.writeHead(404).end();
  });
  httpServers.add(server);
  await new Promise<void>((resolveListen) =>
    server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Comfy unavailable');
  return { origin: `http://127.0.0.1:${address.port}`,
    submissions: () => submissions, classTypes: () => submittedClassTypes,
    interrupts: () => interrupts };
}

function json(response: import('node:http').ServerResponse, body: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function postData(origin: string, pathname: string,
  body: unknown): Promise<Record<string, any>> {
  const response = await fetch(`${origin}${pathname}`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await response.json() as { data?: Record<string, any>;
    error?: unknown };
  if (!response.ok || !payload.data) throw new Error(
    `POST ${pathname} failed (${response.status}): ${JSON.stringify(payload)}`);
  return payload.data;
}

async function waitForImageJob(origin: string, projectId: string,
  jobId: string): Promise<Record<string, any>> {
  return waitForImageJobStatus(origin, projectId, jobId, 'completed');
}

async function waitForImageJobStatus(origin: string, projectId: string,
  jobId: string, expectedStatus: string): Promise<Record<string, any>> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const payload = await fetch(
      `${origin}/api/projects/${projectId}/character_image_jobs`)
      .then((response) => response.json() as Promise<{ data: Array<
        Record<string, any>> }>);
    const job = payload.data.find(({ id }) => id === jobId);
    if (job?.status === expectedStatus) return job;
    if (job && ['failed', 'canceled', 'completed'].includes(String(job.status))) {
      throw new Error(`Image job ended as ${job.status}: ${JSON.stringify(job)}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error(`Image job ${jobId} did not reach ${expectedStatus}`);
}

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUB' +
  'AScY42YAAAAASUVORK5CYII=', 'base64');

function waitForOrigin(child: ChildProcess): Promise<string> {
  return new Promise((resolveOrigin, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Compiled API did not start. stderr: ${stderr}`));
    }, 10_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      const match = /listening at (http:\/\/[^\s]+)/.exec(stdout);
      if (!match?.[1]) return;
      clearTimeout(timeout);
      resolveOrigin(match[1]);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(
        new Error(`Compiled API exited before listening (${code}). ${stderr}`),
      );
    });
  });
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolveExit) => {
    child.once('exit', (code) => resolveExit(code));
  });
}
