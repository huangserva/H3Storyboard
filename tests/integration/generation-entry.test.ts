import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiServer, type ApiServer } from '../../apps/api/src/server.js';

const servers = new Set<ApiServer>();
const directories = new Set<string>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  await Promise.all([...directories].map((path) =>
    rm(path, { recursive: true, force: true })));
  directories.clear();
});

describe('Studio generation entrypoint', () => {
  it('rejects a shot outside the project before creating a job', async () => {
    const api = await startApi();
    const first = await createProject(api.origin, 'First project');
    const second = await createProject(api.origin, 'Second project');
    const shot = await createShot(api.origin, second);

    const response = await post(`${api.origin}/api/projects/${first}/shots/${shot}/jobs`,
      jobInput('t2v', []));
    await expectError(response, 422, 'SHOT_PROJECT_MISMATCH');
  });

  it('reports the unlocked production context with a stable preflight code', async () => {
    const api = await startApi();
    const project = await createProject(api.origin, 'Unlocked project');
    const shot = await createShot(api.origin, project);

    const preflight = await fetch(
      `${api.origin}/api/projects/${project}/shots/${shot}/jobs/preflight`);
    expect(preflight.status).toBe(200);
    expect(await preflight.json()).toMatchObject({ data: {
      ready: false,
      blocking_error: { code: 'LOCK_REQUIRED' },
    } });
    const create = await post(
      `${api.origin}/api/projects/${project}/shots/${shot}/jobs`,
      jobInput('t2v', []));
    await expectError(create, 409, 'LOCK_REQUIRED');
  });

  it('rejects a blocked production mode without persisting a job', async () => {
    const api = await startApi();
    const project = await createProject(api.origin, 'Blocked mode project');
    const shot = await createShot(api.origin, project);
    const mode = await createMode(api.origin, 'blocked-production', ['t2v']);
    await createManifestAsset(api.origin, project);
    await post(`${api.origin}/api/projects/${project}/briefs`, brief('blocked-production'));
    await patch(`${api.origin}/api/modes`, { mode_id: mode,
      validation_status: 'validated', evidence: 'Provider validation passed.' });
    await patch(`${api.origin}/api/modes`, { mode_id: mode,
      validation_status: 'blocked', evidence: 'Provider validation failed.' });
    await put(`${api.origin}/api/projects/${project}/generation_lock`, {
      engaged: true, reason: 'Blocked preflight test',
    });

    const response = await post(
      `${api.origin}/api/projects/${project}/shots/${shot}/jobs`,
      jobInput('t2v', []));
    await expectError(response, 409, 'MODE_BLOCKED');
    expect((await snapshot(api.origin, project)).h3_jobs).toEqual([]);
  });

  it('rejects binding compilation failure without persisting a job', async () => {
    const api = await startApi();
    const project = await createProject(api.origin, 'Binding project');
    const shot = await createShot(api.origin, project);
    await createMode(api.origin, 'image-production', ['i2v']);
    await createManifestAsset(api.origin, project);
    await post(`${api.origin}/api/projects/${project}/briefs`, brief('image-production'));
    await put(`${api.origin}/api/projects/${project}/generation_lock`, {
      engaged: true, reason: 'Binding preflight test',
    });

    const preflight = await fetch(
      `${api.origin}/api/projects/${project}/shots/${shot}/jobs/preflight`);
    expect(await preflight.json()).toMatchObject({ data: {
      ready: false,
      blocking_error: { code: 'MODE_CAPABILITY_MISMATCH' },
    } });
    const response = await post(
      `${api.origin}/api/projects/${project}/shots/${shot}/jobs`,
      jobInput('i2v', []));
    await expectError(response, 422, 'H3_BINDINGS_INVALID');
    expect((await snapshot(api.origin, project)).h3_jobs).toEqual([]);
  });

  it('rejects external audio bindings without persisting a job', async () => {
    const api = await startApi();
    const project = await createProject(api.origin, 'H3 native audio project');
    const shot = await createShot(api.origin, project);
    await createMode(api.origin, 'native-audio-production', ['i2v']);
    const image = await createApprovedAsset(api.origin, project, 'image');
    const audio = await createApprovedAsset(api.origin, project, 'audio');
    await post(`${api.origin}/api/projects/${project}/manifests`, {});
    await patch(`${api.origin}/api/shots/${shot}`, { semantic_references: [{
      purpose: 'first_frame', target: { type: 'asset', asset_id: image },
    }] });
    await post(`${api.origin}/api/projects/${project}/briefs`,
      brief('native-audio-production'));
    await put(`${api.origin}/api/projects/${project}/generation_lock`, {
      engaged: true, reason: 'External audio rejection test',
    });
    const preflight = ((await (await fetch(
      `${api.origin}/api/projects/${project}/shots/${shot}/jobs/preflight`)
    ).json()) as { data: { ready: boolean; input_bindings: unknown[] } }).data;
    expect(preflight.ready).toBe(true);

    const response = await post(
      `${api.origin}/api/projects/${project}/shots/${shot}/jobs`,
      jobInput('i2v', [...preflight.input_bindings, {
        asset_id: audio, asset_kind: 'audio', role: 'audio', ordinal: 1,
      }]));

    await expectError(response, 422, 'H3_BINDINGS_INVALID');
    expect((await snapshot(api.origin, project)).h3_jobs).toEqual([]);
  });

  it('rejects external audio while authoring a new shot plan', async () => {
    const api = await startApi();
    const project = await createProject(api.origin, 'Audio-free shot plan');
    const response = await post(`${api.origin}/api/projects/${project}/shots`, {
      title: 'No external mix', scene_id: 'scene-01', duration_seconds: 5,
      shot_size: 'medium', camera_movement: 'locked',
      action: 'A courier crosses the frame.', dialogue: '', sound: '',
      prompt: 'A cinematic courier crosses a rain-soaked frame.',
      continuity_mode: 'independent', continuity_dependencies: [],
      costume_state: {}, reference_bindings: [{ asset_id: crypto.randomUUID(),
        asset_kind: 'audio', role: 'audio', ordinal: 0 }],
    });
    expect(response.status).toBe(400);
    const body = await response.json() as { error: {
      code: string; details: Array<{ message: string }> } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details.map(({ message }) => message)).toContainEqual(
      expect.stringContaining('H3_EXTERNAL_AUDIO_FORBIDDEN'));
    expect((await snapshot(api.origin, project)).shot_plans).toEqual([]);
  });

  it('creates an immutable scoped job while leaving plan and actual records separate', async () => {
    const api = await startApi();
    const project = await createProject(api.origin, 'Ready project');
    const shot = await createShot(api.origin, project);
    await createMode(api.origin, 'ready-image-production', ['i2v']);
    const asset = await createManifestAsset(api.origin, project);
    await patch(`${api.origin}/api/shots/${shot}`, { semantic_references: [{
      purpose: 'first_frame', target: { type: 'asset', asset_id: asset },
    }] });
    await post(`${api.origin}/api/projects/${project}/briefs`,
      brief('ready-image-production'));
    await put(`${api.origin}/api/projects/${project}/generation_lock`, {
      engaged: true, reason: 'Ready generation test',
    });
    const preflight = ((await (await fetch(
      `${api.origin}/api/projects/${project}/shots/${shot}/jobs/preflight`)
    ).json()) as { data: { ready: boolean; input_bindings: unknown[] } }).data;
    expect(preflight.ready).toBe(true);

    const response = await post(
      `${api.origin}/api/projects/${project}/shots/${shot}/jobs`,
      jobInput('i2v', preflight.input_bindings));
    expect(response.status).toBe(201);
    const job = ((await response.json()) as { data: {
      shot_plan_id: string; lock_snapshot: unknown; compiled_bindings: unknown[];
    } }).data;
    expect(job).toMatchObject({ shot_plan_id: shot,
      lock_snapshot: { brief_version: 1, manifest_version: 1,
        mode_key: 'ready-image-production' } });
    expect(job.compiled_bindings).toHaveLength(1);
    const persisted = await snapshot(api.origin, project);
    expect(persisted.h3_jobs).toHaveLength(1);
    expect(persisted.shot_actuals).toEqual([]);
    expect(persisted.shot_plans).toHaveLength(1);
  });

  it('persists silent audio mode through the HTTP boundary and a SQLite restart', async () => {
    const api = await startApi();
    const project = await createProject(api.origin, 'Silent restart project');
    const shot = await createShot(api.origin, project);
    await createMode(api.origin, 'silent-image-production', ['i2v']);
    const asset = await createManifestAsset(api.origin, project);
    await patch(`${api.origin}/api/shots/${shot}`, { semantic_references: [{
      purpose: 'first_frame', target: { type: 'asset', asset_id: asset },
    }] });
    await post(`${api.origin}/api/projects/${project}/briefs`,
      brief('silent-image-production'));
    await put(`${api.origin}/api/projects/${project}/generation_lock`, {
      engaged: true, reason: 'Silent persistence integration test',
    });
    const preflight = ((await (await fetch(
      `${api.origin}/api/projects/${project}/shots/${shot}/jobs/preflight`)
    ).json()) as { data: { input_bindings: unknown[] } }).data;

    const created = await post(
      `${api.origin}/api/projects/${project}/shots/${shot}/jobs`,
      { ...jobInput('i2v', preflight.input_bindings), audio_mode: 'silent' });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ data: { audio_mode: 'silent' } });

    await api.server.close();
    servers.delete(api.server);
    const restarted = createApiServer({ database_path: api.databasePath, port: 0 });
    servers.add(restarted);
    const { origin } = await restarted.start();
    const persisted = await snapshot(origin, project) as { h3_jobs: Array<{
      shot_plan_id: string; audio_mode: string }> };
    expect(persisted.h3_jobs).toContainEqual(expect.objectContaining({
      shot_plan_id: shot,
      audio_mode: 'silent',
    }));
  });
});

async function startApi() {
  const directory = await mkdtemp(join(tmpdir(), 'h3-generation-entry-'));
  directories.add(directory);
  const databasePath = join(directory, 'project.db');
  const server = createApiServer({ database_path: databasePath, port: 0 });
  servers.add(server);
  const { origin } = await server.start();
  return { origin, server, databasePath };
}

async function createProject(origin: string, title: string): Promise<string> {
  const response = await post(`${origin}/api/projects`, { title,
    script_title: `${title} script`,
    script_content: 'A complete locked script provides enough production context.' });
  return ((await response.json()) as { data: { id: string } }).data.id;
}

async function createShot(origin: string, project: string): Promise<string> {
  const response = await post(`${origin}/api/projects/${project}/shots`, {
    title: 'Generation shot', scene_id: 'scene-01', duration_seconds: 5,
    shot_size: 'medium', camera_movement: 'locked',
    action: 'A courier crosses the frame.', dialogue: '', sound: 'Rain.',
    prompt: 'A cinematic courier crosses a rain-soaked frame.',
    continuity_mode: 'independent', continuity_dependencies: [],
    costume_state: {}, reference_bindings: [],
  });
  return ((await response.json()) as { data: { id: string } }).data.id;
}

async function createMode(origin: string, key: string,
  generationModes: string[]): Promise<string> {
  const response = await post(`${origin}/api/modes`, { key, title: key,
    description: 'Generation entry integration mode.', capability_declaration: {
      generation_modes: generationModes, duration_seconds: { min: 4, max: 15 },
      resolution: { min_width: 480, max_width: 480,
        min_height: 864, max_height: 864 }, lora_profile_requirements: [],
      provider_requirements: ['local_comfyui'], extensions: {},
    } });
  return ((await response.json()) as { data: { id: string } }).data.id;
}

async function createManifestAsset(origin: string, project: string): Promise<string> {
  const assetId = await createApprovedAsset(origin, project, 'image');
  await post(`${origin}/api/projects/${project}/manifests`, {});
  return assetId;
}

async function createApprovedAsset(origin: string, project: string,
  kind: 'image' | 'audio'): Promise<string> {
  const created = await post(`${origin}/api/projects/${project}/assets`, {
    kind, name: `${kind} context`, uri: `context/${project}.${kind}`,
    content_hash: null,
  });
  const asset = ((await created.json()) as { data: { id: string } }).data;
  await patch(`${origin}/api/projects/${project}/assets`, {
    asset_id: asset.id, status: 'approved',
  });
  return asset.id;
}

function brief(mode_key: string) {
  return { mode_key, body: { logline: 'A courier crosses frame.',
    style_notes: 'Cinematic rain.', text_style_lock: null,
    hard_rules: ['Preserve the planned shot.'] } };
}

function jobInput(mode: string, input_bindings: unknown[]) {
  return { mode, provider: 'local_comfyui', model: 'H3-local',
    prompt: 'A cinematic courier crosses a rain-soaked frame.',
    duration_seconds: 5, seed: 42, steps: 4,
    idempotency_key: `studio-${crypto.randomUUID()}`, input_bindings };
}

async function snapshot(origin: string, project: string) {
  return ((await (await fetch(`${origin}/api/projects/${project}`)).json()) as {
    data: { h3_jobs: unknown[]; shot_actuals: unknown[]; shot_plans: unknown[] };
  }).data;
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}

function request(url: string, method: string, body: unknown) {
  return fetch(url, { method, headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body) });
}
const post = (url: string, body: unknown) => request(url, 'POST', body);
const patch = (url: string, body: unknown) => request(url, 'PATCH', body);
const put = (url: string, body: unknown) => request(url, 'PUT', body);
