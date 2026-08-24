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
      data: { status: 'ok', protocol_version: '1.6' },
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
