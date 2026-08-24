import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { ComfyUIClient } from '../../packages/h3-provider/src/index.js';
import { ProjectStore } from '../../packages/project-store/src/index.js';
import {
  CharacterImageLeaseWorker,
  H3LeaseWorker,
  SharedGpuCoordinator,
} from '../../packages/task-engine/src/index.js';

const VIDEO_BYTES = Buffer.from('real-http-stub-h3-output');
const directories: string[] = [];
const stores: ProjectStore[] = [];
const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>(
    (resolveClose, reject) => server.close((error) => error
      ? reject(error) : resolveClose()),
  )));
  for (const directory of directories.splice(0)) rmSync(directory, {
    recursive: true, force: true,
  });
});

describe('real H3 and character-image workers share one persisted GPU lease', () => {
  test('simultaneous runOnce calls permit one HTTP submission and defer the peer',
    async () => {
      const fixture = seedConcurrentJobs();
      const comfy = await startComfyServer();
      const h3Client = client(comfy.endpoint);
      const imageClient = client(comfy.endpoint);
      const coordinatorOptions = {
        lease_store: fixture.store.gpuLeases,
        gpu_host: 'newgpu:4090',
        queue_clients: [h3Client, imageClient],
        managed_free_clients: [],
        memory_client: h3Client,
        minimum_free_vram_bytes: 0,
        lease_duration_ms: 3_000_000,
        settle_ms: 0,
      } as const;
      const h3Worker = new H3LeaseWorker({
        store: fixture.store,
        client: h3Client,
        gpu_coordinator: new SharedGpuCoordinator(coordinatorOptions),
        data_directory: fixture.directory,
        lease_duration_ms: 3_000_000,
        width: 480,
        height: 864,
        fps: 24,
        turbo: false,
        loras: [],
      });
      const imageWorker = new CharacterImageLeaseWorker({
        store: fixture.store,
        client: imageClient,
        gpu_coordinator: new SharedGpuCoordinator({
          ...coordinatorOptions, memory_client: imageClient,
        }),
        data_directory: fixture.directory,
        lease_duration_ms: 3_000_000,
      });

      const h3Run = h3Worker.runOnce();
      const imageRun = imageWorker.runOnce();
      const [h3Result, imageResult] = await Promise.all([h3Run, imageRun]);

      expect(h3Result).toMatchObject({
        outcome: 'completed', job_id: fixture.h3JobId,
      });
      expect(imageResult).toMatchObject({
        outcome: 'timed_out', job_id: fixture.imageJobId,
        error_code: 'IMAGE_COMFY_QUEUE_BUSY',
      });
      expect(comfy.counts).toMatchObject({ prompt: 1, upload: 1, view: 1 });
      expect(fixture.store.getH3Job(fixture.h3JobId).status).toBe('completed');
      expect(fixture.store.characterImageJobs.get(fixture.imageJobId))
        .toMatchObject({ status: 'timed_out',
          error_code: 'IMAGE_COMFY_QUEUE_BUSY', provider_job_id: null });
      expect(fixture.store.gpuLeases.get('newgpu:4090')).toBeNull();
    });
});

function seedConcurrentJobs() {
  const directory = mkdtempSync(join(tmpdir(), 'h3-shared-worker-'));
  directories.push(directory);
  const store = new ProjectStore(join(directory, 'storyboard.db'));
  stores.push(store);

  const imageProject = store.createProject({ title: 'Image owner',
    script_title: 'Image owner', script_content:
      'An image worker competes for the same persisted GPU host.' });
  const character = store.characters.create(imageProject.id, { name: '林澜',
    canonical_appearance: 'Chinese woman with stable facial geometry.',
    status: 'approved' });
  const imageJob = store.characterImageJobs.create(
    imageProject.id,
    character.id,
    { operation: 'master_t2i', provider: 'local_comfyui', engine: 'krea2',
      prompt: 'Neutral cinematic character portrait.', seed: 2026082401,
      width: 480, height: 864, steps: 8, cfg: 1,
      sampler: 'euler_ancestral', scheduler: 'sgm_uniform', denoise: null,
      lora_profile: null, lora_name: null, lora_strength: null,
      source_reference_ids: [], idempotency_key: 'shared-gpu-image-job' },
  );

  const h3Project = store.createProject({ title: 'H3 owner',
    script_title: 'H3 owner', script_content:
      'An H3 video worker competes for the same persisted GPU host.' });
  const inputPath = `projects/${h3Project.id}/inputs/first.png`;
  mkdirSync(dirname(join(directory, inputPath)), { recursive: true });
  writeFileSync(join(directory, inputPath), PNG_1X1);
  const input = store.createAsset(h3Project.id, { kind: 'image', name: 'First',
    relative_path: inputPath,
    content_hash: `sha256:${createHash('sha256').update(PNG_1X1).digest('hex')}`,
    status: 'candidate' });
  store.updateAsset(h3Project.id, { asset_id: input.id, status: 'approved' });
  const modeKey = `shared-gpu-${h3Project.id.slice(0, 8)}`;
  store.modes.create({ key: modeKey, title: 'Shared GPU I2V',
    description: 'Real worker concurrency integration mode.',
    capability_declaration: { generation_modes: ['i2v'],
      duration_seconds: { min: 2, max: 15 },
      resolution: { min_width: 32, max_width: 2048, min_height: 32,
        max_height: 2048 }, lora_profile_requirements: [],
      provider_requirements: ['local_comfyui'], extensions: {} } });
  const shot = store.createShotPlan(h3Project.id, { title: 'Lease shot',
    scene_id: 'GPU-01', duration_seconds: 5, shot_size: 'medium',
    camera_movement: 'locked', action: 'The subject waits.',
    semantic_references: [{ purpose: 'first_frame',
      target: { type: 'asset', asset_id: input.id } }],
    opening_state: null, ending_state: null });
  store.freezeCurrentAssetsManifest(h3Project.id);
  store.production.createBrief(h3Project.id, { mode_key: modeKey, body: {
    logline: 'One H3 worker owns one GPU.', style_notes: 'Cinematic.',
    text_style_lock: null, hard_rules: [],
  } });
  store.production.updateLock(h3Project.id, { engaged: true,
    reason: 'Concurrency fixture is ready' });
  const h3Job = store.createH3Job(shot.id, { mode: 'i2v',
    provider: 'local_comfyui', model: 'H3-local',
    prompt: 'A locked cinematic portrait shot.', duration_seconds: 5,
    seed: 2026082402, steps: 20, audio_mode: 'silent',
    idempotency_key: 'shared-gpu-h3-job', input_bindings: [{
      asset_id: input.id, asset_kind: 'image', role: 'first_frame', ordinal: 0,
    }] });
  return { directory, store, imageJobId: imageJob.id, h3JobId: h3Job.id };
}

async function startComfyServer() {
  const counts = { queue: 0, upload: 0, prompt: 0, history: 0, view: 0 };
  const server = createServer(async (request, response) => {
    const path = request.url ?? '';
    if (path === '/queue') {
      counts.queue += 1;
      return json(response, { queue_running: [], queue_pending: [] });
    }
    if (path === '/upload/image') {
      counts.upload += 1;
      await drain(request);
      return json(response, { name: 'first.png', subfolder: 'integration' });
    }
    if (path === '/prompt') {
      counts.prompt += 1;
      await drain(request);
      return json(response, { prompt_id: 'h3-prompt-1', node_errors: {} });
    }
    if (path === '/history/h3-prompt-1') {
      counts.history += 1;
      return json(response, { 'h3-prompt-1': { status: { completed: true },
        outputs: { '7': { videos: [{ filename: 'result.mp4',
          subfolder: 'integration', type: 'output' }] } } } });
    }
    if (path.startsWith('/view?')) {
      counts.view += 1;
      response.writeHead(200, { 'content-type': 'video/mp4' });
      return response.end(VIDEO_BYTES);
    }
    response.writeHead(404);
    response.end();
  });
  servers.push(server);
  await new Promise<void>((resolveListen) => server.listen(
    0, '127.0.0.1', resolveListen,
  ));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error(
    'Comfy integration server did not expose an address',
  );
  return { endpoint: `http://127.0.0.1:${address.port}`, counts };
}

function client(endpoint: string) {
  return new ComfyUIClient({ endpoint, poll_interval_ms: 0,
    poll_max_attempts: 1 });
}

async function drain(request: IncomingMessage): Promise<void> {
  for await (const _chunk of request) { /* drain request body */ }
}

function json(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
