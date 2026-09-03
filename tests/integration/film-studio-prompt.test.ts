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

const I2VA_HEAD =
  'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.';

/** ADR 0003: the H3 prompt is compiled by h3-film-studio at the job boundary. */
describe('h3-film-studio prompt compilation at the job boundary', () => {
  it('replaces the client prompt with the compiled official-format prompt and records the skill revision', async () => {
    const api = await startApi();
    const project = await createProject(api.origin, 'Compiled prompt project');
    const shot = await createShot(api.origin, project, true);
    const preflight = await readyPreflight(api.origin, project, shot, 'compiled-image-production');
    expect(preflight.ready).toBe(true);
    expect(preflight.compiled_prompt?.startsWith(I2VA_HEAD)).toBe(true);
    expect(preflight.compiled_prompt).toContain('(S1) mutters: <d>[Chinese] 又下雨了。</d>');
    expect(preflight.film_studio_revision).toMatch(/^[0-9a-f]{40}$|^unknown$/);

    const response = await post(`${api.origin}/api/projects/${project}/shots/${shot}/jobs`,
      { ...jobInput('i2v', preflight.input_bindings), prompt: 'HAND WRITTEN PROMPT MUST NOT RUN' });
    expect(response.status).toBe(201);
    const job = ((await response.json()) as { data: { prompt: string;
      film_studio_revision: string | null } }).data;
    expect(job.prompt).toBe(preflight.compiled_prompt);
    expect(job.prompt).not.toContain('HAND WRITTEN');
    expect(job.film_studio_revision).toBe(preflight.film_studio_revision);
    expect(job.prompt).toContain('overall_soundscape: Steady rain on pavement');
    expect(job.prompt).toContain('non_diegetic_music: N/A');
  });

  it('blocks generation when the plan has no structured spec', async () => {
    const api = await startApi();
    const project = await createProject(api.origin, 'Spec required project');
    const shot = await createShot(api.origin, project, false);
    await createMode(api.origin, 'spec-required-production', ['i2v']);
    const asset = await createManifestAsset(api.origin, project);
    await patch(`${api.origin}/api/shots/${shot}`, { semantic_references: [{
      purpose: 'first_frame', target: { type: 'asset', asset_id: asset } }] });
    await post(`${api.origin}/api/projects/${project}/briefs`, brief('spec-required-production'));
    await put(`${api.origin}/api/projects/${project}/generation_lock`, {
      engaged: true, reason: 'Spec required test' });
    const preflight = await getPreflight(api.origin, project, shot);
    expect(preflight.ready).toBe(false);
    expect(preflight.blocking_error?.code).toBe('H3_PROMPT_SPEC_REQUIRED');
    expect(preflight.compiled_prompt).toBeNull();
    const bindings = [{ asset_id: asset, asset_kind: 'image', role: 'first_frame', ordinal: 0 }];
    for (const url of [`${api.origin}/api/projects/${project}/shots/${shot}/jobs`,
      `${api.origin}/api/shots/${shot}/jobs`]) {
      const response = await post(url, jobInput('i2v', bindings));
      expect(response.status).toBe(422);
      expect(((await response.json()) as { error: { code: string } }).error.code)
        .toBe('H3_PROMPT_SPEC_REQUIRED');
    }
    expect((await snapshot(api.origin, project)).h3_jobs).toEqual([]);
  });

  it('rejects Chinese outside <d> with the compiler code and stores nothing', async () => {
    const api = await startApi();
    const project = await createProject(api.origin, 'Compiler rejection project');
    const shot = await createShot(api.origin, project, true);
    await createMode(api.origin, 'rejected-image-production', ['i2v']);
    const asset = await createManifestAsset(api.origin, project);
    await patch(`${api.origin}/api/shots/${shot}`, { semantic_references: [{
      purpose: 'first_frame', target: { type: 'asset', asset_id: asset } }],
      h3_prompt_spec: { style: 'Live-action, cinematic',
        anchor: '她低头看着桌上的银锭', beats: [], soundscape: 'Quiet room tone.',
        lines: [], silent_subjects: [], camera: 'The camera holds a static shot',
        music: 'N/A' } });
    await post(`${api.origin}/api/projects/${project}/briefs`, brief('rejected-image-production'));
    await put(`${api.origin}/api/projects/${project}/generation_lock`, {
      engaged: true, reason: 'Compiler rejection test' });
    const preflight = await getPreflight(api.origin, project, shot);
    expect(preflight.ready).toBe(false);
    expect(preflight.blocking_error?.code).toBe('FILM_STUDIO_COMPILER_REJECTED');
    const response = await post(`${api.origin}/api/projects/${project}/shots/${shot}/jobs`,
      jobInput('i2v', [{ asset_id: asset, asset_kind: 'image', role: 'first_frame', ordinal: 0 }]));
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { code: string } }).error.code)
      .toBe('FILM_STUDIO_COMPILER_REJECTED');
    expect((await snapshot(api.origin, project)).h3_jobs).toEqual([]);
  });
});

async function readyPreflight(origin: string, project: string, shot: string,
  modeKey: string) {
  await createMode(origin, modeKey, ['i2v']);
  const asset = await createManifestAsset(origin, project);
  await patch(`${origin}/api/shots/${shot}`, { semantic_references: [{
    purpose: 'first_frame', target: { type: 'asset', asset_id: asset } }] });
  await post(`${origin}/api/projects/${project}/briefs`, brief(modeKey));
  await put(`${origin}/api/projects/${project}/generation_lock`, {
    engaged: true, reason: 'Prompt compilation test' });
  return getPreflight(origin, project, shot);
}

async function getPreflight(origin: string, project: string, shot: string) {
  return ((await (await fetch(
    `${origin}/api/projects/${project}/shots/${shot}/jobs/preflight`)).json()) as {
    data: { ready: boolean; input_bindings: unknown[]; compiled_prompt: string | null;
      film_studio_revision: string | null;
      blocking_error: { code: string } | null } }).data;
}

async function createShot(origin: string, project: string, withSpec: boolean): Promise<string> {
  const response = await post(`${origin}/api/projects/${project}/shots`, {
    title: 'Compiled shot', scene_id: 'scene-01', duration_seconds: 5,
    shot_size: 'medium', camera_movement: 'locked',
    action: 'A courier crosses the frame.', dialogue: '又下雨了。', sound: 'Rain.',
    prompt: '',
    ...(withSpec ? { h3_prompt_spec: { style: 'Live-action, cinematic', anchor: 'a medium shot frames the courier shown in <Picture 1> on a rain-soaked street', beats: ['He crosses the frame and stops under the awning'], soundscape: 'Steady rain on pavement with distant traffic.', lines: [{ speaker: 'S1', who: 'The courier with a tired, low voice', verb: 'mutters', text: '又下雨了。', lang: 'Chinese', after: '' }], silent_subjects: [], camera: 'The camera holds a static shot', music: 'N/A' }, } : {}),
    continuity_mode: 'independent', continuity_dependencies: [],
    costume_state: {}, reference_bindings: [],
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { data: { id: string } }).data.id;
}

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
