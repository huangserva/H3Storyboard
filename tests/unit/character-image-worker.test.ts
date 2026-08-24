import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ProjectStore } from '../../packages/project-store/src/index.js';
import { ComfyUIClient } from '../../packages/h3-provider/src/index.js';
import { CharacterImageLeaseWorker, SharedGpuCoordinator } from
  '../../packages/task-engine/src/index.js';

const directories: string[] = [];
const stores: ProjectStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(directories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })));
});

describe('CharacterImageLeaseWorker', () => {
  test('submits once and atomically registers a decoded candidate image',
    async () => {
      const fixture = await seedMasterJob();
      const calls: string[] = [];
      let submittedGraph: unknown = null;
      const client = new ComfyUIClient({ endpoint: 'http://krea.test',
        poll_interval_ms: 0, poll_max_attempts: 2, fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
          if (url.pathname === '/queue') return Response.json({
            queue_running: [], queue_pending: [],
          });
          if (url.pathname === '/free') return Response.json({});
          if (url.pathname === '/system_stats') return Response.json({ devices: [{
            name: 'RTX 4090', type: 'cuda', index: 0,
            vram_total: 48 * 1024 ** 3, vram_free: 20 * 1024 ** 3,
          }] });
          if (url.pathname === '/object_info') return Response.json(
            Object.fromEntries(['UNETLoader', 'CLIPLoader', 'VAELoader',
              'CLIPTextEncode', 'ConditioningZeroOut', 'EmptyLatentImage',
              'KSampler', 'VAEDecode', 'SaveImage'].map((node) => [node, {}])));
          if (url.pathname === '/prompt') {
            submittedGraph = JSON.parse(String(init?.body));
            return Response.json({ prompt_id: 'image-prompt-1', node_errors: {} });
          }
          if (url.pathname === '/history/image-prompt-1') return Response.json({
            'image-prompt-1': { status: { completed: true }, outputs: {
              save: { images: [{ filename: 'output.png', type: 'output' }] },
            } },
          });
          if (url.pathname === '/view') return new Response(PNG_1X1,
            { status: 200, headers: { 'content-type': 'image/png' } });
          return new Response('missing', { status: 404 });
        } });
      const coordinator = new SharedGpuCoordinator({
        lease_store: fixture.store.gpuLeases, gpu_host: 'newgpu:0',
        queue_clients: [client], managed_free_clients: [client],
        memory_client: client, minimum_free_vram_bytes: 17 * 1024 ** 3,
        lease_duration_ms: 120_000, settle_ms: 0,
      });
      const worker = new CharacterImageLeaseWorker({ store: fixture.store,
        client, gpu_coordinator: coordinator, data_directory: fixture.directory,
        lease_duration_ms: 120_000, idle_interval_ms: 1 });

      const result = await worker.runOnce();

      expect(result).toMatchObject({ outcome: 'completed',
        job_id: fixture.jobId, provider_task_id: 'image-prompt-1' });
      const completed = fixture.store.characterImageJobs.get(fixture.jobId);
      expect(completed).toMatchObject({ status: 'completed', attempt: 1,
        provider_job_id: 'image-prompt-1' });
      const asset = fixture.store.getAsset(completed.output_asset_id!);
      expect(asset).toMatchObject({ status: 'candidate', kind: 'image',
        producer_image_job_id: fixture.jobId });
      expect(await readFile(join(fixture.directory, asset.relative_path)))
        .toEqual(PNG_1X1);
      expect(submittedGraph).toMatchObject({ client_id: expect.any(String),
        prompt: { sampler: { class_type: 'KSampler' } } });
      expect(calls.filter((call) => call === 'POST /prompt')).toHaveLength(1);
      expect(fixture.store.gpuLeases.get('newgpu:0')).toBeNull();
    });

  test('defers without upload, free, or prompt when a peer queue is busy',
    async () => {
      const fixture = await seedMasterJob();
      const current = endpointClient(false);
      const peer = endpointClient(true);
      const coordinator = new SharedGpuCoordinator({
        lease_store: fixture.store.gpuLeases, gpu_host: 'newgpu:0',
        queue_clients: [current.client, peer.client],
        managed_free_clients: [current.client, peer.client],
        memory_client: current.client, minimum_free_vram_bytes: 0,
        lease_duration_ms: 120_000, settle_ms: 0,
      });
      const worker = new CharacterImageLeaseWorker({ store: fixture.store,
        client: current.client, gpu_coordinator: coordinator,
        data_directory: fixture.directory, lease_duration_ms: 120_000 });

      await expect(worker.runOnce()).resolves.toMatchObject({
        outcome: 'timed_out', error_code: 'IMAGE_COMFY_QUEUE_BUSY',
      });
      expect(current.calls.some((call) => call.includes('/upload/image'))).toBe(false);
      expect(current.calls.some((call) => call.includes('/prompt'))).toBe(false);
      expect(current.calls.some((call) => call.includes('/free'))).toBe(false);
      expect(peer.calls.some((call) => call.includes('/free'))).toBe(false);
      expect(fixture.store.gpuLeases.get('newgpu:0')).toBeNull();
      await expect(worker.runOnce()).resolves.toEqual({ outcome: 'idle' });
    });

  test('rejects a non-image history output without downloading it', async () => {
    const fixture = await seedMasterJob();
    const downloads: string[] = [];
    const client = new ComfyUIClient({ endpoint: 'http://krea.test',
      poll_interval_ms: 0, poll_max_attempts: 2, fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === '/queue') return Response.json({
          queue_running: [], queue_pending: [],
        });
        if (url.pathname === '/free') return Response.json({});
        if (url.pathname === '/system_stats') return Response.json({ devices: [{
          name: 'RTX 4090', type: 'cuda', vram_total: 48 * 1024 ** 3,
          vram_free: 20 * 1024 ** 3,
        }] });
        if (url.pathname === '/object_info') return Response.json(
          Object.fromEntries(['UNETLoader', 'CLIPLoader', 'VAELoader',
            'CLIPTextEncode', 'ConditioningZeroOut', 'EmptyLatentImage',
            'KSampler', 'VAEDecode', 'SaveImage'].map((node) => [node, {}])));
        if (url.pathname === '/prompt') return Response.json({
          prompt_id: 'video-output', node_errors: {},
        });
        if (url.pathname === '/history/video-output') return Response.json({
          'video-output': { status: { completed: true }, outputs: {
            save: { videos: [{ filename: 'wrong.mp4', type: 'output' }] },
          } },
        });
        if (url.pathname === '/view') downloads.push(String(input));
        return new Response('missing', { status: 404 });
      } });
    const coordinator = new SharedGpuCoordinator({
      lease_store: fixture.store.gpuLeases, gpu_host: 'newgpu:0',
      queue_clients: [client], managed_free_clients: [client],
      memory_client: client, minimum_free_vram_bytes: 0,
      lease_duration_ms: 120_000, settle_ms: 0,
    });
    const worker = new CharacterImageLeaseWorker({ store: fixture.store,
      client, gpu_coordinator: coordinator, data_directory: fixture.directory,
      lease_duration_ms: 120_000 });

    await expect(worker.runOnce()).resolves.toMatchObject({
      outcome: 'failed', error_code: 'IMAGE_OUTPUT_MISSING',
    });
    expect(downloads).toHaveLength(0);
    expect(fixture.store.characterImageJobs.get(fixture.jobId).status)
      .toBe('failed');
  });

  test('recovers a persisted submit intent by client id without resubmitting',
    async () => {
      const fixture = await seedMasterJob();
      const claimed = fixture.store.characterImageJobs.claim(
        fixture.jobId, 120_000);
      fixture.store.characterImageJobs.markSubmitIntent(
        fixture.jobId, claimed.lease_token!, 'recover-client');
      fixture.store.characterImageJobs.defer(fixture.jobId, claimed.lease_token!,
        'IMAGE_COMFY_TIMEOUT', 'Simulated submit crash');
      const raw = new Database(join(fixture.directory, 'storyboard.db'));
      raw.prepare('UPDATE character_image_jobs SET updated_at = ? WHERE id = ?')
        .run('2000-01-01T00:00:00.000Z', fixture.jobId);
      raw.close();
      const calls: string[] = [];
      const client = new ComfyUIClient({ endpoint: 'http://krea.test',
        poll_interval_ms: 0, fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
          if (url.pathname === '/queue') return Response.json({
            queue_running: [[0, 'recovered-prompt', {}, {
              client_id: 'recover-client',
            }]], queue_pending: [],
          });
          if (url.pathname === '/history') return Response.json({});
          if (url.pathname === '/history/recovered-prompt') return Response.json({
            'recovered-prompt': { status: { completed: true }, outputs: {
              save: { images: [{ filename: 'recovered.png', type: 'output' }] },
            } },
          });
          if (url.pathname === '/view') return new Response(PNG_1X1);
          return new Response('missing', { status: 404 });
        } });
      const worker = imageWorker(fixture, client, []);

      await expect(worker.runOnce()).resolves.toMatchObject({
        outcome: 'completed', provider_task_id: 'recovered-prompt',
      });
      expect(calls.filter((call) => call === 'POST /prompt')).toHaveLength(0);
      expect(calls.filter((call) => call === 'POST /free')).toHaveLength(0);
      expect(fixture.store.characterImageJobs.get(fixture.jobId)).toMatchObject({
        status: 'completed', provider_client_id: 'recover-client',
        provider_job_id: 'recovered-prompt', attempt: 2,
      });
    });

  test('cancels only the active provider prompt and stops polling', async () => {
    const fixture = await seedMasterJob();
    let promptId: string | null = null;
    let interrupted = 0;
    let leaseHeldDuringInterrupt = false;
    let statusDuringInterrupt = '';
    const client = hangingClient(() => promptId, (value) => { promptId = value; },
      () => {
        interrupted += 1;
        leaseHeldDuringInterrupt = fixture.store.gpuLeases.get('newgpu:0') !== null;
        statusDuringInterrupt = fixture.store.characterImageJobs.get(
          fixture.jobId).status;
      });
    const worker = imageWorker(fixture, client, [client]);
    const running = worker.runOnce();
    await until(() => fixture.store.characterImageJobs.get(
      fixture.jobId).status === 'running');

    await worker.cancel(fixture.jobId, 'Director canceled this render');
    await expect(running).resolves.toMatchObject({
      outcome: 'failed', error_code: 'IMAGE_COMFY_ABORTED',
    });
    expect(interrupted).toBe(1);
    expect(leaseHeldDuringInterrupt).toBe(true);
    expect(statusDuringInterrupt).toBe('running');
    expect(fixture.store.characterImageJobs.get(fixture.jobId)).toMatchObject({
      status: 'canceled', cancel_reason: 'Director canceled this render',
    });
  });

  test('does not report local cancellation when exact provider cancel fails',
    async () => {
      const fixture = await seedMasterJob();
      let promptId: string | null = null;
      const client = hangingClient(() => promptId,
        (value) => { promptId = value; }, () => undefined, 503);
      const worker = imageWorker(fixture, client, [client]);
      worker.start();
      await until(() => fixture.store.characterImageJobs.get(
        fixture.jobId).status === 'running');

      await expect(worker.cancel(fixture.jobId, 'Cancel must reach provider'))
        .rejects.toMatchObject({ code: 'H3_COMFY_HTTP_ERROR' });
      expect(fixture.store.characterImageJobs.get(fixture.jobId).status)
        .toBe('running');
      expect(fixture.store.gpuLeases.get('newgpu:0')).not.toBeNull();

      await worker.stop();
      expect(fixture.store.characterImageJobs.get(fixture.jobId)).toMatchObject({
        status: 'timed_out', error_code: 'IMAGE_COMFY_TIMEOUT',
      });
    });

  test('recovers and cancels a prompt accepted during the submit response window',
    async () => {
      const fixture = await seedMasterJob();
      let clientId: string | null = null;
      let promptAccepted = false;
      let interrupted = 0;
      let leaseHeldDuringInterrupt = false;
      const client = new ComfyUIClient({ endpoint: 'http://krea.test',
        poll_interval_ms: 1, poll_max_attempts: 100,
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/queue') return Response.json({
            queue_running: promptAccepted ? [[0, 'accepted-prompt', {}, {
              client_id: clientId,
            }]] : [], queue_pending: [],
          });
          if (url.pathname === '/free') return Response.json({});
          if (url.pathname === '/system_stats') return Response.json({ devices: [{
            name: 'RTX 4090', type: 'cuda', vram_total: 48 * 1024 ** 3,
            vram_free: 20 * 1024 ** 3,
          }] });
          if (url.pathname === '/object_info') return Response.json(
            Object.fromEntries(['UNETLoader', 'CLIPLoader', 'VAELoader',
              'CLIPTextEncode', 'ConditioningZeroOut', 'EmptyLatentImage',
              'KSampler', 'VAEDecode', 'SaveImage'].map((node) => [node, {}])));
          if (url.pathname === '/prompt') {
            const body = JSON.parse(String(init?.body)) as { client_id: string };
            clientId = body.client_id;
            promptAccepted = true;
            return new Promise<Response>((_resolve, reject) =>
              init?.signal?.addEventListener('abort', () =>
                reject(init.signal!.reason), { once: true }));
          }
          if (url.pathname === '/history') return Response.json({});
          if (url.pathname === '/interrupt') {
            interrupted += 1;
            leaseHeldDuringInterrupt = fixture.store.gpuLeases.get(
              'newgpu:0') !== null;
            return Response.json({});
          }
          return new Response('missing', { status: 404 });
        } });
      const worker = imageWorker(fixture, client, [client]);
      worker.start();
      await until(() => promptAccepted && fixture.store.characterImageJobs.get(
        fixture.jobId).provider_client_id !== null);

      await expect(worker.cancel(fixture.jobId, 'Cancel accepted prompt'))
        .resolves.toMatchObject({ status: 'canceled',
          provider_client_id: clientId });
      expect(interrupted).toBe(1);
      expect(leaseHeldDuringInterrupt).toBe(true);
      await worker.stop();
      expect(fixture.store.gpuLeases.get('newgpu:0')).toBeNull();
    });

  test('cancels a timed-out provider prompt under a newly acquired GPU lease',
    async () => {
      const fixture = await seedMasterJob();
      const claimed = fixture.store.characterImageJobs.claim(
        fixture.jobId, 120_000);
      fixture.store.characterImageJobs.markSubmitIntent(
        fixture.jobId, claimed.lease_token!, 'inactive-client');
      fixture.store.characterImageJobs.markQueued(
        fixture.jobId, claimed.lease_token!, 'inactive-prompt');
      fixture.store.characterImageJobs.markRunning(
        fixture.jobId, claimed.lease_token!);
      fixture.store.characterImageJobs.defer(fixture.jobId, claimed.lease_token!,
        'IMAGE_COMFY_TIMEOUT', 'Worker stopped before cancellation.');
      fixture.store.characterImageJobs.retry(fixture.projectId, fixture.jobId, {
        idempotency_key: crypto.randomUUID(),
      });
      let leaseHeldDuringInterrupt = false;
      const client = hangingClient(() => 'inactive-prompt', () => undefined,
        () => { leaseHeldDuringInterrupt = fixture.store.gpuLeases.get(
          'newgpu:0') !== null; });
      const worker = imageWorker(fixture, client, [client]);

      await expect(worker.cancel(fixture.jobId, 'Cancel inactive provider task'))
        .resolves.toMatchObject({ status: 'canceled', attempt: 1 });
      expect(leaseHeldDuringInterrupt).toBe(true);
      expect(fixture.store.gpuLeases.get('newgpu:0')).toBeNull();
    });

  test('stop aborts polling quickly and preserves the provider task for recovery',
    async () => {
      const fixture = await seedMasterJob();
      let promptId: string | null = null;
      const client = hangingClient(() => promptId, (value) => { promptId = value; },
        () => undefined);
      const worker = imageWorker(fixture, client, [client]);
      worker.start();
      await until(() => fixture.store.characterImageJobs.get(
        fixture.jobId).status === 'running');
      const started = Date.now();

      await worker.stop();

      expect(Date.now() - started).toBeLessThan(1_000);
      expect(fixture.store.characterImageJobs.get(fixture.jobId)).toMatchObject({
        status: 'timed_out', error_code: 'IMAGE_COMFY_TIMEOUT',
        provider_job_id: 'hanging-prompt',
      });
    });

  test.each(['/queue', '/object_info', '/free', '/system_stats', '/prompt',
    '/view'])('stop aborts an in-flight %s provider request', async (target) => {
    const fixture = await seedMasterJob();
    let entered = () => undefined;
    const targetEntered = new Promise<void>((resolveEntered) => {
      entered = resolveEntered;
    });
    let blocked = false;
    const client = new ComfyUIClient({ endpoint: 'http://krea.test',
      poll_interval_ms: 0, poll_max_attempts: 2,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === target && !blocked) {
          blocked = true;
          entered();
          if (!init?.signal) throw new Error(`${target} omitted worker signal`);
          return new Promise<Response>((_resolve, reject) =>
            init.signal!.addEventListener('abort', () =>
              reject(init.signal!.reason), { once: true }));
        }
        if (url.pathname === '/queue') return Response.json({
          queue_running: [], queue_pending: [],
        });
        if (url.pathname === '/free') return Response.json({});
        if (url.pathname === '/system_stats') return Response.json({ devices: [{
          name: 'RTX 4090', type: 'cuda', vram_total: 48 * 1024 ** 3,
          vram_free: 20 * 1024 ** 3,
        }] });
        if (url.pathname === '/object_info') return Response.json(
          Object.fromEntries(['UNETLoader', 'CLIPLoader', 'VAELoader',
            'CLIPTextEncode', 'ConditioningZeroOut', 'EmptyLatentImage',
            'KSampler', 'VAEDecode', 'SaveImage'].map((node) => [node, {}])));
        if (url.pathname === '/prompt') return Response.json({
          prompt_id: 'phase-prompt', node_errors: {},
        });
        if (url.pathname === '/history/phase-prompt') return Response.json({
          'phase-prompt': { status: { completed: true }, outputs: {
            save: { images: [{ filename: 'phase.png', type: 'output' }] },
          } },
        });
        if (url.pathname === '/view') return new Response(PNG_1X1);
        return new Response('missing', { status: 404 });
      } });
    const worker = imageWorker(fixture, client, [client],
      target === '/system_stats' ? 1 : 0);
    worker.start();
    await targetEntered;

    await worker.stop();

    expect(fixture.store.characterImageJobs.get(fixture.jobId)).toMatchObject({
      status: 'timed_out', error_code: 'IMAGE_COMFY_TIMEOUT',
    });
    expect(fixture.store.gpuLeases.get('newgpu:0')).toBeNull();
  });
});

function imageWorker(fixture: Awaited<ReturnType<typeof seedMasterJob>>,
  client: ComfyUIClient, managed: ComfyUIClient[], minimumFreeVram = 0) {
  const coordinator = new SharedGpuCoordinator({
    lease_store: fixture.store.gpuLeases, gpu_host: 'newgpu:0',
    queue_clients: [client], managed_free_clients: managed,
    memory_client: client, minimum_free_vram_bytes: minimumFreeVram,
    lease_duration_ms: 120_000, settle_ms: 0,
  });
  return new CharacterImageLeaseWorker({ store: fixture.store, client,
    gpu_coordinator: coordinator, data_directory: fixture.directory,
    lease_duration_ms: 120_000, idle_interval_ms: 1 });
}

function hangingClient(getPromptId: () => string | null,
  setPromptId: (value: string) => void, interrupt: () => void,
  interruptStatus = 200) {
  return new ComfyUIClient({ endpoint: 'http://krea.test',
    poll_interval_ms: 10, poll_max_attempts: 10_000,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/queue') return Response.json({
        queue_running: getPromptId() ? [[0, getPromptId(), {}, {}]] : [],
        queue_pending: [],
      });
      if (url.pathname === '/free') return Response.json({});
      if (url.pathname === '/system_stats') return Response.json({ devices: [{
        name: 'RTX 4090', type: 'cuda', vram_total: 48 * 1024 ** 3,
        vram_free: 20 * 1024 ** 3,
      }] });
      if (url.pathname === '/object_info') return Response.json(
        Object.fromEntries(['UNETLoader', 'CLIPLoader', 'VAELoader',
          'CLIPTextEncode', 'ConditioningZeroOut', 'EmptyLatentImage',
          'KSampler', 'VAEDecode', 'SaveImage'].map((node) => [node, {}])));
      if (url.pathname === '/prompt') {
        setPromptId('hanging-prompt');
        return Response.json({ prompt_id: 'hanging-prompt', node_errors: {} });
      }
      if (url.pathname === '/history/hanging-prompt') return Response.json({});
      if (url.pathname === '/interrupt' && init?.method === 'POST') {
        interrupt(); return Response.json({}, { status: interruptStatus });
      }
      return new Response('missing', { status: 404 });
    } });
}

async function until(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error('Condition did not become true');
}

async function seedMasterJob() {
  const directory = await mkdtemp(join(tmpdir(), 'h3-image-worker-'));
  directories.push(directory);
  const store = new ProjectStore(join(directory, 'storyboard.db'));
  stores.push(store);
  const project = store.createProject({ title: 'Character image worker',
    script_title: 'Character image worker',
    script_content: 'A complete script for the character image worker.' });
  const character = store.characters.create(project.id, { name: '林澜',
    canonical_appearance: 'Chinese woman with a stable face and closed mouth.',
    seed_family: [2026082401], status: 'approved' });
  const job = store.characterImageJobs.create(project.id, character.id, {
    operation: 'master_t2i', provider: 'local_comfyui', engine: 'krea2',
    prompt: 'cinematic portrait, closed mouth, neutral expression',
    seed: 2026082401, width: 480, height: 864, steps: 8, cfg: 1,
    sampler: 'euler_ancestral', scheduler: 'sgm_uniform', denoise: null,
    lora_profile: null, lora_name: null, lora_strength: null,
    source_reference_ids: [], idempotency_key: crypto.randomUUID(),
  });
  return { directory, store, projectId: project.id, jobId: job.id };
}

function endpointClient(busy: boolean) {
  const calls: string[] = [];
  const client = new ComfyUIClient({ endpoint: busy ? 'http://h3.test' :
    'http://krea.test', poll_interval_ms: 0, fetch: async (input, init) => {
      const url = new URL(String(input));
      calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
      if (url.pathname === '/queue') return Response.json({
        queue_running: busy ? [[0, 'external-prompt', {}, {}]] : [],
        queue_pending: [],
      });
      if (url.pathname === '/free') return Response.json({});
      return new Response('missing', { status: 404 });
    } });
  return { client, calls };
}

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
