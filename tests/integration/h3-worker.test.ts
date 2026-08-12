import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ComfyUIClient } from '../../packages/h3-provider/src/index.js';
import { ProjectStore } from '../../packages/project-store/src/index.js';
import { H3LeaseWorker } from '../../packages/task-engine/src/index.js';

const outputBytes = Buffer.from('stub-h3-video-with-audio');
const directories: string[] = [];
const stores: ProjectStore[] = [];
const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>(
    (resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
  for (const directory of directories.splice(0)) rmSync(directory,
    { recursive: true, force: true });
});

describe('H3 lease worker with real SQLite and stub ComfyUI HTTP', () => {
  it('submits once and atomically registers a hashed candidate asset and pending take', async () => {
    const fixture = seedWorkerJob();
    const stub = await startComfyStub('success');
    const worker = createWorker(fixture.store, fixture.directory, stub.endpoint);

    const result = await worker.runOnce();

    expect(result).toMatchObject({ outcome: 'completed', job_id: fixture.jobId });
    expect(stub.counts).toMatchObject({ free: 1, upload: 1, prompt: 1 });
    const snapshot = fixture.store.getProjectSnapshot(fixture.projectId);
    const job = snapshot.h3_jobs.find(({ id }) => id === fixture.jobId)!;
    const output = snapshot.assets.find(({ id }) => id === job.output_asset_id)!;
    const actual = snapshot.shot_actuals.find(({ job_id }) => job_id === job.id)!;
    expect(job.status).toBe('completed');
    expect(job.provider_job_id).toBe('prompt-1');
    expect(output).toMatchObject({ kind: 'video', status: 'candidate',
      content_hash: `sha256:${createHash('sha256').update(outputBytes).digest('hex')}`,
      producer_job_id: job.id });
    expect(readFileSync(join(fixture.directory, output.relative_path))).toEqual(outputBytes);
    expect(actual).toMatchObject({ output_asset_id: output.id,
      qc_verdict: 'pending' });
  });

  it('recovers an expired lease by polling the persisted task without resubmitting', async () => {
    const fixture = seedWorkerJob();
    const claimed = fixture.store.claimH3Job(fixture.jobId);
    fixture.store.markH3JobQueued(fixture.jobId, claimed.lease_token!, 'prompt-1');
    fixture.store.markH3JobRunning(fixture.jobId, claimed.lease_token!);
    fixture.store.close();
    stores.splice(stores.indexOf(fixture.store), 1);
    const raw = new Database(fixture.databasePath);
    raw.prepare('UPDATE h3_jobs SET lease_expires_at = ? WHERE id = ?')
      .run('2000-01-01T00:00:00.000Z', fixture.jobId);
    raw.close();
    const reopened = track(new ProjectStore(fixture.databasePath));
    const stub = await startComfyStub('success');

    const result = await createWorker(reopened, fixture.directory,
      stub.endpoint).runOnce();

    expect(result.outcome).toBe('completed');
    expect(stub.counts).toMatchObject({ free: 0, upload: 0, prompt: 0,
      history: 1, view: 1 });
    expect(reopened.getProjectSnapshot(fixture.projectId).h3_jobs
      .find(({ id }) => id === fixture.jobId)?.provider_job_id).toBe('prompt-1');
  });

  it('fails a zero-byte download without creating an output asset or take', async () => {
    const fixture = seedWorkerJob();
    const stub = await startComfyStub('empty-download');

    const result = await createWorker(fixture.store, fixture.directory,
      stub.endpoint).runOnce();

    expect(result).toMatchObject({ outcome: 'failed',
      error_code: 'H3_COMFY_EMPTY_DOWNLOAD' });
    const snapshot = fixture.store.getProjectSnapshot(fixture.projectId);
    expect(snapshot.h3_jobs.find(({ id }) => id === fixture.jobId)).toMatchObject({
      status: 'failed', output_asset_id: null,
      error_code: 'H3_COMFY_EMPTY_DOWNLOAD',
    });
    expect(snapshot.assets).toHaveLength(1);
    expect(snapshot.shot_actuals).toHaveLength(0);
  });

  it('records an explicit cancel reason and never submits a canceled lease', async () => {
    const fixture = seedWorkerJob();
    const claimed = fixture.store.claimH3Job(fixture.jobId);
    const stub = await startComfyStub('success');
    const worker = createWorker(fixture.store, fixture.directory, stub.endpoint);

    const canceled = worker.cancel(fixture.jobId, 'Director canceled test run');

    expect(canceled).toMatchObject({ status: 'canceled',
      cancel_reason: 'Director canceled test run' });
    expect(claimed.lease_token).not.toBeNull();
    expect(await worker.runOnce()).toEqual({ outcome: 'idle' });
    expect(stub.counts.prompt).toBe(0);
  });

  it('submits an r2v job with every compiled image in deterministic order', async () => {
    const fixture = seedR2VWorkerJob();
    const stub = await startComfyStub('success');
    const worker = createWorker(fixture.store, fixture.directory, stub.endpoint,
      { kind: 'hybrid', block_range_start: 30, block_range_end: 49 });

    const result = await worker.runOnce();

    expect(result).toMatchObject({ outcome: 'completed', job_id: fixture.jobId });
    expect(stub.counts).toMatchObject({ free: 1, upload: 2, prompt: 1 });
    const graph = (stub.prompts[0] as { prompt: Record<string, {
      class_type: string; inputs: Record<string, unknown> }> }).prompt;
    expect(graph['1']?.class_type).toBe('MiniMaxH3HybridLoader');
    expect(graph['5']?.class_type).toBe('MiniMaxH3ReferenceToVideo');
    expect(graph['5']?.inputs['ref_images.ref_image_0']).toEqual(['8', 0]);
    expect(graph['5']?.inputs['ref_images.ref_image_1']).toEqual(['9', 0]);
  });
});

function seedWorkerJob() {
  const directory = mkdtempSync(join(tmpdir(), 'h3-worker-'));
  directories.push(directory);
  const databasePath = join(directory, 'storyboard.db');
  const store = track(new ProjectStore(databasePath));
  const project = store.createProject({ title: 'Worker integration',
    script_title: 'Worker',
    script_content: 'A complete worker integration script with enough detail.' });
  const imagePath = `projects/${project.id}/inputs/start.png`;
  mkdirSync(dirname(join(directory, imagePath)), { recursive: true });
  writeFileSync(join(directory, imagePath), Buffer.from('stub-image'));
  const image = store.createAsset(project.id, { kind: 'image', name: 'Start',
    relative_path: imagePath, content_hash: 'sha256:input', status: 'candidate' });
  store.updateAsset(project.id, { asset_id: image.id, status: 'approved' });
  store.modes.create({ key: `worker-${project.id.slice(0, 8)}`,
    title: 'Worker I2V', description: 'I2V worker integration mode.',
    capability_declaration: { generation_modes: ['i2v'],
      duration_seconds: { min: 2, max: 15 },
      resolution: { min_width: 32, max_width: 2048, min_height: 32,
        max_height: 2048 }, lora_profile_requirements: [],
      provider_requirements: ['local_comfyui'], extensions: {} } });
  const modeKey = `worker-${project.id.slice(0, 8)}`;
  const shot = store.createShotPlan(project.id, { title: 'Worker shot',
    scene_id: 'SC-W', duration_seconds: 5, shot_size: 'medium',
    camera_movement: 'locked', action: 'The subject waits.',
    semantic_references: [{ purpose: 'first_frame',
      target: { type: 'asset', asset_id: image.id } }],
    opening_state: null, ending_state: null });
  store.freezeCurrentAssetsManifest(project.id);
  store.production.createBrief(project.id, { mode_key: modeKey,
    body: { logline: 'A worker completes one take.', style_notes: 'Cinematic.',
      text_style_lock: null, hard_rules: [] } });
  store.production.updateLock(project.id, { engaged: true,
    reason: 'Worker integration fixture' });
  const job = store.createH3Job(shot.id, { mode: 'i2v',
    provider: 'local_comfyui', model: 'H3-local',
    prompt: 'A cinematic locked shot in soft rain.', duration_seconds: 5,
    seed: 20260811, steps: 20, idempotency_key: `worker-${project.id}`,
    input_bindings: [{ asset_id: image.id, asset_kind: 'image',
      role: 'first_frame', ordinal: 0 }] });
  return { directory, databasePath, store, projectId: project.id,
    jobId: job.id };
}

function seedR2VWorkerJob() {
  const directory = mkdtempSync(join(tmpdir(), 'h3-r2v-worker-'));
  directories.push(directory);
  const databasePath = join(directory, 'storyboard.db');
  const store = track(new ProjectStore(databasePath));
  const project = store.createProject({ title: 'R2V worker integration',
    script_title: 'R2V worker', script_content:
      'A courier crosses a rainy alley while preserving her approved identity.' });
  const paths = [`projects/${project.id}/inputs/scene.png`,
    `projects/${project.id}/inputs/character.png`];
  for (const path of paths) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), Buffer.from(`stub-${path}`));
  }
  const assets = paths.map((relative_path, index) => store.createAsset(project.id,
    { kind: 'image', name: `Reference ${index + 1}`, relative_path,
      content_hash: `sha256:input-${index}`, status: 'candidate' }));
  for (const asset of assets) store.updateAsset(project.id,
    { asset_id: asset.id, status: 'approved' });
  const modeKey = `r2v-worker-${project.id.slice(0, 8)}`;
  store.modes.create({ key: modeKey, title: 'Worker R2V',
    description: 'R2V worker integration mode.', capability_declaration: {
      generation_modes: ['r2v'], duration_seconds: { min: 2, max: 15 },
      resolution: { min_width: 32, max_width: 2048, min_height: 32,
        max_height: 2048 }, lora_profile_requirements: [],
      provider_requirements: ['local_comfyui'], extensions: {} } });
  const shot = store.createShotPlan(project.id, { title: 'R2V worker shot',
    scene_id: 'SC-R', duration_seconds: 5, shot_size: 'medium',
    camera_movement: 'locked', action: 'The courier waits in the alley.',
    semantic_references: [
      { purpose: 'first_frame', target: { type: 'asset', asset_id: assets[0]!.id } },
      { purpose: 'reference_style', target: { type: 'asset', asset_id: assets[1]!.id } },
    ], opening_state: null, ending_state: null });
  store.freezeCurrentAssetsManifest(project.id);
  store.production.createBrief(project.id, { mode_key: modeKey, body: {
    logline: 'A worker completes one reference take.', style_notes: 'Cinematic.',
    text_style_lock: null, hard_rules: [] } });
  store.production.updateLock(project.id, { engaged: true,
    reason: 'R2V worker integration fixture' });
  const job = store.createH3Job(shot.id, { mode: 'r2v',
    provider: 'local_comfyui', model: 'H3-hybrid', prompt:
      '<Picture 1> is the rainy alley. <Picture 2> is the courier identity.',
    duration_seconds: 5, seed: 20260812, steps: 4,
    idempotency_key: `r2v-worker-${project.id}`, input_bindings: [
      { asset_id: assets[0]!.id, asset_kind: 'image', role: 'first_frame', ordinal: 0 },
      { asset_id: assets[1]!.id, asset_kind: 'image', role: 'style', ordinal: 1 },
    ] });
  return { directory, databasePath, store, projectId: project.id,
    jobId: job.id };
}

function createWorker(store: ProjectStore, dataDirectory: string, endpoint: string,
  r2vLoader = { kind: 'stock' } as const) {
  return new H3LeaseWorker({ store,
    client: new ComfyUIClient({ endpoint, poll_interval_ms: 0,
      poll_max_attempts: 1 }), data_directory: dataDirectory,
    lease_duration_ms: 60_000, width: 480, height: 864, fps: 24,
    turbo: false, loras: [], generate_audio: true, r2v_loader: r2vLoader });
}

async function startComfyStub(mode: 'success' | 'empty-download') {
  const counts = { free: 0, upload: 0, prompt: 0, history: 0, view: 0 };
  const prompts: unknown[] = [];
  const server = createServer(async (request, response) => {
    const path = request.url ?? '';
    if (path === '/free') { counts.free += 1; await drain(request);
      return json(response, { ok: true }); }
    if (path === '/upload/image') { counts.upload += 1; await drain(request);
      return json(response, { name: 'start.png', subfolder: 'worker' }); }
    if (path === '/prompt') { counts.prompt += 1;
      prompts.push(JSON.parse((await body(request)).toString('utf8')));
      return json(response, { prompt_id: 'prompt-1', node_errors: {} }); }
    if (path === '/history/prompt-1') { counts.history += 1;
      return json(response, { 'prompt-1': { status: { completed: true },
        outputs: { '7': { videos: [{ filename: 'output.mp4',
          subfolder: 'worker', type: 'output' }] } } } }); }
    if (path.startsWith('/view?')) { counts.view += 1;
      response.writeHead(200, { 'content-type': 'video/mp4' });
      return response.end(mode === 'empty-download' ? Buffer.alloc(0) : outputBytes); }
    response.writeHead(404); response.end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing stub address');
  return { endpoint: `http://127.0.0.1:${address.port}`, counts, prompts };
}

function track(store: ProjectStore) { stores.push(store); return store; }
async function drain(request: IncomingMessage) { for await (const _ of request) { /* drain */ } }
async function body(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
function json(response: ServerResponse, body: unknown) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}
