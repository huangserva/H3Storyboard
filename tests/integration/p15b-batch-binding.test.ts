import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CreateH3JobBatchResultSchema,
  type GenerationPreflightBatch,
} from '@h3storyboard/protocol';
import { openProjectStore } from '../../packages/project-store/src/index.js';
import { createApiServer, type ApiServer } from '../../apps/api/src/server.js';

const servers = new Set<ApiServer>();
const directories = new Set<string>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  await Promise.all([...directories].map((directory) =>
    rm(directory, { recursive: true, force: true })));
  directories.clear();
});

describe('P1.5B batch jobs and drag binding HTTP contracts', () => {
  it('persists semantic bindings, rejects locked edits, and isolates projects',
    async () => {
      const api = await startApi();
      const project = await createProject(api.origin, 'Binding project');
      const shot = await createShot(api.origin, project, 1);
      const image = await createApprovedImage(api.origin, project, 'Bound frame');

      const bound = await post(`${api.origin}/api/projects/${project}/shots/${shot}` +
        '/bindings', { binding_type: 'semantic', purpose: 'first_frame',
        target: { type: 'asset', asset_id: image } });
      expect(bound.status).toBe(200);
      expect(await bound.json()).toMatchObject({ data: {
        id: shot, semantic_references: [{ purpose: 'first_frame',
          target: { type: 'asset', asset_id: image } }],
      } });

      await put(`${api.origin}/api/projects/${project}/generation_lock`, {
        engaged: true, reason: 'Lock binding test',
      });
      const locked = await post(`${api.origin}/api/projects/${project}/shots/${shot}` +
        '/bindings', { binding_type: 'semantic', purpose: 'last_frame',
        target: { type: 'asset', asset_id: image } });
      await expectError(locked, 409, 'LOCK_ENGAGED');

      await put(`${api.origin}/api/projects/${project}/generation_lock`, {
        engaged: false,
      });
      const foreignProject = await createProject(api.origin, 'Foreign binding');
      const foreignImage = await createApprovedImage(
        api.origin, foreignProject, 'Foreign frame');
      const foreign = await post(`${api.origin}/api/projects/${project}/shots/${shot}` +
        '/bindings', { binding_type: 'semantic', purpose: 'first_frame',
        target: { type: 'asset', asset_id: foreignImage } });
      await expectError(foreign, 422, 'ASSET_PROJECT_MISMATCH');
      const archivedImage = await createApprovedImage(
        api.origin, project, 'Archived frame');
      expect((await patch(`${api.origin}/api/projects/${project}/assets`, {
        asset_id: archivedImage, status: 'archived',
      })).status).toBe(200);
      const archived = await post(
        `${api.origin}/api/projects/${project}/shots/${shot}/bindings`, {
          binding_type: 'semantic', purpose: 'first_frame',
          target: { type: 'asset', asset_id: archivedImage },
        });
      await expectError(archived, 409, 'ASSET_ARCHIVED');
      const malformed = await post(`${api.origin}/api/projects/%E0%A4%A/shots/` +
        `${shot}/bindings`, { binding_type: 'semantic', purpose: 'first_frame',
        target: { type: 'asset', asset_id: image } });
      await expectError(malformed, 400, 'ROUTE_PARAMETER_INVALID');
      expect((await projectSnapshot(api.origin, project)).shot_plans[0])
        .toMatchObject({ semantic_references: [{ target: { asset_id: image } }] });
    });

  it('creates an atomic idempotent batch and converges concurrent repeats',
    async () => {
      const api = await startApi();
      const fixture = await readyFixture(api.origin, 2);
      const body = batchBody(fixture.preflights, fixture.shots);
      await put(`${api.origin}/api/projects/${fixture.project}/generation_lock`, {
        engaged: false,
      });
      const unlocked = await post(
        `${api.origin}/api/projects/${fixture.project}/jobs/batch`, body);
      await expectError(unlocked, 409, 'LOCK_REQUIRED');
      expect((await projectSnapshot(api.origin, fixture.project)).h3_jobs)
        .toEqual([]);
      await put(`${api.origin}/api/projects/${fixture.project}/generation_lock`, {
        engaged: true, reason: 'Resume atomic batch test',
      });
      const [firstResponse, concurrentResponse] = await Promise.all([
        post(`${api.origin}/api/projects/${fixture.project}/jobs/batch`, body),
        post(`${api.origin}/api/projects/${fixture.project}/jobs/batch`, body),
      ]);
      expect(firstResponse.status).toBe(201);
      expect(concurrentResponse.status).toBe(201);
      const first = CreateH3JobBatchResultSchema.parse(
        ((await firstResponse.json()) as { data: unknown }).data);
      const concurrent = CreateH3JobBatchResultSchema.parse(
        ((await concurrentResponse.json()) as { data: unknown }).data);
      expect(first.items.map(({ job }) => job.id)).toEqual(
        concurrent.items.map(({ job }) => job.id));
      expect((await projectSnapshot(api.origin, fixture.project)).h3_jobs)
        .toHaveLength(2);

      const activeConflict = await post(
        `${api.origin}/api/projects/${fixture.project}/jobs/batch`,
        batchBodyWithPrefix(fixture.preflights, fixture.shots, 'different'));
      await expectError(activeConflict, 409, 'H3_JOB_ACTIVE');
      expect((await projectSnapshot(api.origin, fixture.project)).h3_jobs)
        .toHaveLength(2);

      const foreignProject = await createProject(api.origin, 'Foreign batch');
      const foreignShot = await createShot(api.origin, foreignProject, 1);
      const rejected = await post(
        `${api.origin}/api/projects/${fixture.project}/jobs/batch`, { items: [
          batchItem(fixture.shots[0]!, fixture.preflights, 'new-first'),
          { ...batchItem(fixture.shots[1]!, fixture.preflights, 'new-second'),
            shot_plan_id: foreignShot },
        ] });
      await expectError(rejected, 422, 'SHOT_PROJECT_MISMATCH');
      expect((await projectSnapshot(api.origin, fixture.project)).h3_jobs)
        .toHaveLength(2);
    });

  it('rolls back the full batch on a real SQLite mid-write failure', async () => {
    const api = await startApi();
    const fixture = await readyFixture(api.origin, 2);
    const database = new Database(api.databasePath);
    try {
      database.exec(`CREATE TRIGGER fail_p15b_job_batch
        BEFORE INSERT ON h3_jobs
        WHEN NEW.shot_plan_id = '${fixture.shots[1]}'
        BEGIN SELECT RAISE(ABORT, 'forced P1.5B failure'); END`);
    } finally { database.close(); }

    const response = await post(
      `${api.origin}/api/projects/${fixture.project}/jobs/batch`,
      batchBody(fixture.preflights, fixture.shots));
    await expectError(response, 500, 'INTERNAL_ERROR');
    expect((await projectSnapshot(api.origin, fixture.project)).h3_jobs)
      .toEqual([]);
  });

  it('binds a validated approved Take boundary as chained continuity', async () => {
    const api = await startApi();
    const fixture = await readyFixture(api.origin, 2);
    const created = await post(
      `${api.origin}/api/projects/${fixture.project}/jobs/batch`,
      batchBody(fixture.preflights, [fixture.shots[0]!]));
    expect(created.status).toBe(201);
    const job = CreateH3JobBatchResultSchema.parse(
      ((await created.json()) as { data: unknown }).data).items[0]!.job;
    await put(`${api.origin}/api/projects/${fixture.project}/generation_lock`, {
      engaged: false,
    });

    const store = openProjectStore(api.databasePath);
    let takeId = '';
    let boundaryId = '';
    let openingBoundaryId = '';
    let fakeBoundaryId = '';
    try {
      const claimed = store.claimH3Job(job.id);
      store.markH3JobQueued(job.id, claimed.lease_token!, 'p15b-provider');
      store.markH3JobRunning(job.id, claimed.lease_token!);
      const completed = store.finalizeWorkerOutput(job.id, claimed.lease_token!, {
        name: 'source.mp4', relative_path: 'outputs/source.mp4',
        content_hash: `sha256:${'1'.repeat(64)}`,
        observed_description: 'Approved source Take.',
      });
      takeId = completed.actual.id;
      const boundary = store.createAsset(fixture.project, { kind: 'image',
        name: 'source-last.png', relative_path: 'outputs/source-last.png',
        content_hash: `sha256:${'2'.repeat(64)}`,
        derived_from_asset_id: completed.asset.id, derivation_kind: 'last_frame' });
      boundaryId = store.updateAsset(fixture.project, {
        asset_id: boundary.id, status: 'approved',
      }).id;
      const openingBoundary = store.createAsset(fixture.project, { kind: 'image',
        name: 'source-first.png', relative_path: 'outputs/source-first.png',
        content_hash: `sha256:${'4'.repeat(64)}`,
        derived_from_asset_id: completed.asset.id, derivation_kind: 'first_frame' });
      openingBoundaryId = store.updateAsset(fixture.project, {
        asset_id: openingBoundary.id, status: 'approved',
      }).id;
      const fakeBoundary = store.createAsset(fixture.project, { kind: 'image',
        name: 'unbacked-last.png', relative_path: 'outputs/unbacked-last.png',
        content_hash: `sha256:${'3'.repeat(64)}` });
      fakeBoundaryId = store.updateAsset(fixture.project, {
        asset_id: fakeBoundary.id, status: 'approved',
      }).id;
    } finally { store.close(); }

    const pending = await post(`${api.origin}/api/projects/${fixture.project}` +
      `/shots/${fixture.shots[1]}/bindings`, { binding_type: 'continuity',
      purpose: 'first_frame', source_shot_plan_id: fixture.shots[0],
      source_take_id: takeId, reference_asset_id: boundaryId,
      boundary: 'last_frame' });
    await expectError(pending, 422, 'CONTINUITY_DEPENDENCY_INVALID');

    const reviewStore = openProjectStore(api.databasePath);
    try { reviewStore.reviewShotActual(takeId, { qc_verdict: 'approved' }); }
    finally { reviewStore.close(); }

    const fakeBoundary = await post(`${api.origin}/api/projects/${fixture.project}` +
      `/shots/${fixture.shots[1]}/bindings`, { binding_type: 'continuity',
      purpose: 'first_frame', source_shot_plan_id: fixture.shots[0],
      source_take_id: takeId, reference_asset_id: fakeBoundaryId,
      boundary: 'last_frame' });
    await expectError(fakeBoundary, 422, 'CONTINUITY_DEPENDENCY_INVALID');

    const selfReference = await post(`${api.origin}/api/projects/${fixture.project}` +
      `/shots/${fixture.shots[0]}/bindings`, { binding_type: 'continuity',
      purpose: 'first_frame', source_shot_plan_id: fixture.shots[0],
      source_take_id: takeId, reference_asset_id: boundaryId,
      boundary: 'last_frame' });
    await expectError(selfReference, 422, 'CONTINUITY_DEPENDENCY_INVALID');

    const response = await post(`${api.origin}/api/projects/${fixture.project}` +
      `/shots/${fixture.shots[1]}/bindings`, { binding_type: 'continuity',
      purpose: 'first_frame', source_shot_plan_id: fixture.shots[0],
      source_take_id: takeId, reference_asset_id: boundaryId,
      boundary: 'last_frame' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: {
      continuity_mode: 'chained',
      continuity_dependencies: [{ source_take_id: takeId,
        reference_asset_id: boundaryId, boundary: 'last_frame' }],
      reference_bindings: [{ asset_id: boundaryId, asset_kind: 'image',
        role: 'first_frame', ordinal: 0 }],
      semantic_references: expect.arrayContaining([{ purpose: 'first_frame',
        target: { type: 'asset', asset_id: boundaryId } }]),
    } });

    const addEnding = await post(`${api.origin}/api/projects/${fixture.project}` +
      `/shots/${fixture.shots[1]}/bindings`, { binding_type: 'continuity',
      purpose: 'last_frame', source_shot_plan_id: fixture.shots[0],
      source_take_id: takeId, reference_asset_id: openingBoundaryId,
      boundary: 'first_frame' });
    expect(addEnding.status).toBe(200);
    expect(await addEnding.json()).toMatchObject({ data: {
      continuity_mode: 'chained',
      continuity_dependencies: expect.arrayContaining([
        expect.objectContaining({ reference_asset_id: boundaryId,
          boundary: 'last_frame' }),
        expect.objectContaining({ reference_asset_id: openingBoundaryId,
          boundary: 'first_frame' }),
      ]),
    } });

    const reuseBoundary = await post(
      `${api.origin}/api/projects/${fixture.project}` +
      `/shots/${fixture.shots[1]}/bindings`, { binding_type: 'continuity',
        purpose: 'last_frame', source_shot_plan_id: fixture.shots[0],
        source_take_id: takeId, reference_asset_id: boundaryId,
        boundary: 'last_frame' });
    expect(reuseBoundary.status).toBe(200);
    expect(await reuseBoundary.json()).toMatchObject({ data: {
      continuity_mode: 'chained',
      continuity_dependencies: [expect.objectContaining({
        reference_asset_id: boundaryId, boundary: 'last_frame',
      })],
      reference_bindings: [
        expect.objectContaining({ asset_id: boundaryId, role: 'first_frame' }),
        expect.objectContaining({ asset_id: boundaryId, role: 'last_frame' }),
      ],
    } });

    const replaceOpening = await post(
      `${api.origin}/api/projects/${fixture.project}` +
      `/shots/${fixture.shots[1]}/bindings`, { binding_type: 'semantic',
        purpose: 'first_frame', target: { type: 'asset', asset_id: fakeBoundaryId } });
    expect(replaceOpening.status).toBe(200);
    expect(await replaceOpening.json()).toMatchObject({ data: {
      continuity_mode: 'visual_match',
      continuity_dependencies: [expect.objectContaining({
        reference_asset_id: boundaryId,
      })],
    } });
  });

  it('rejects a boundary derived from a rejected Take', async () => {
    const api = await startApi();
    const fixture = await readyFixture(api.origin, 2);
    const created = await post(
      `${api.origin}/api/projects/${fixture.project}/jobs/batch`,
      batchBody(fixture.preflights, [fixture.shots[0]!]));
    const job = CreateH3JobBatchResultSchema.parse(
      ((await created.json()) as { data: unknown }).data).items[0]!.job;
    await put(`${api.origin}/api/projects/${fixture.project}/generation_lock`, {
      engaged: false,
    });
    const store = openProjectStore(api.databasePath);
    let takeId = '';
    let boundaryId = '';
    try {
      const claimed = store.claimH3Job(job.id);
      store.markH3JobQueued(job.id, claimed.lease_token!,
        'p15b-rejected-provider');
      store.markH3JobRunning(job.id, claimed.lease_token!);
      const completed = store.finalizeWorkerOutput(job.id, claimed.lease_token!, {
        name: 'rejected.mp4', relative_path: 'outputs/rejected.mp4',
        content_hash: `sha256:${'7'.repeat(64)}`,
        observed_description: 'Rejected source Take.',
      });
      takeId = store.reviewShotActual(completed.actual.id, {
        qc_verdict: 'rejected',
      }).id;
      const boundary = store.createAsset(fixture.project, { kind: 'image',
        name: 'rejected-last.png', relative_path: 'outputs/rejected-last.png',
        content_hash: `sha256:${'8'.repeat(64)}`,
        derived_from_asset_id: completed.asset.id,
        derivation_kind: 'last_frame' });
      boundaryId = store.updateAsset(fixture.project, {
        asset_id: boundary.id, status: 'approved',
      }).id;
    } finally { store.close(); }

    const response = await post(`${api.origin}/api/projects/${fixture.project}` +
      `/shots/${fixture.shots[1]}/bindings`, { binding_type: 'continuity',
      purpose: 'first_frame', source_shot_plan_id: fixture.shots[0],
      source_take_id: takeId, reference_asset_id: boundaryId,
      boundary: 'last_frame' });
    await expectError(response, 422, 'CONTINUITY_DEPENDENCY_INVALID');
  });
});

async function startApi() {
  const directory = await mkdtemp(join(tmpdir(), 'h3-p15b-'));
  directories.add(directory);
  const databasePath = join(directory, 'project.db');
  const server = createApiServer({ database_path: databasePath, port: 0 });
  servers.add(server);
  const address = await server.start();
  return { ...address, databasePath };
}

async function readyFixture(origin: string, count: number) {
  const project = await createProject(origin, `Ready batch ${crypto.randomUUID()}`);
  const shots: string[] = [];
  for (let ordinal = 1; ordinal <= count; ordinal += 1) {
    shots.push(await createShot(origin, project, ordinal));
  }
  const image = await createApprovedImage(origin, project, 'Shared first frame');
  for (const shot of shots) {
    const response = await post(`${origin}/api/projects/${project}/shots/${shot}` +
      '/bindings', { binding_type: 'semantic', purpose: 'first_frame',
      target: { type: 'asset', asset_id: image } });
    expect(response.status).toBe(200);
  }
  const mode = `p15b-${crypto.randomUUID().slice(0, 8)}`;
  expect((await post(`${origin}/api/modes`, { key: mode, title: mode,
    description: 'P1.5B atomic batch integration mode.', capability_declaration: {
      generation_modes: ['i2v'], duration_seconds: { min: 4, max: 15 },
      resolution: { min_width: 480, max_width: 480,
        min_height: 864, max_height: 864 }, lora_profile_requirements: [],
      provider_requirements: ['local_comfyui'], extensions: {},
    } })).status).toBe(201);
  expect((await post(`${origin}/api/projects/${project}/manifests`, {})).status)
    .toBe(201);
  expect((await post(`${origin}/api/projects/${project}/briefs`, { mode_key: mode,
    body: { logline: 'Atomic P1.5B batch.', style_notes: 'Cinematic.',
      text_style_lock: null, hard_rules: ['H3 native audio or silence only'] },
  })).status).toBe(201);
  expect((await put(`${origin}/api/projects/${project}/generation_lock`, {
    engaged: true, reason: 'P1.5B batch test',
  })).status).toBe(200);
  const preflights = ((await (await fetch(
    `${origin}/api/projects/${project}/jobs/preflights`)).json()) as {
      data: GenerationPreflightBatch;
    }).data;
  expect(preflights.items.every(({ preflight }) => preflight.ready)).toBe(true);
  return { project, shots, preflights };
}

function batchBody(preflights: GenerationPreflightBatch, shots: string[]) {
  return { items: shots.map((shot, index) =>
    batchItem(shot, preflights, `batch-${index}`)) };
}

function batchBodyWithPrefix(preflights: GenerationPreflightBatch, shots: string[],
  prefix: string) {
  return { items: shots.map((shot, index) =>
    batchItem(shot, preflights, `${prefix}-${index}`)) };
}

function batchItem(shot: string, preflights: GenerationPreflightBatch,
  key: string) {
  const preflight = preflights.items.find(
    ({ shot_plan_id }) => shot_plan_id === shot)!.preflight;
  return { shot_plan_id: shot, job: { mode: preflight.mode,
    provider: 'local_comfyui', model: 'H3-local',
    prompt: `P1.5B atomic generation ${shot}.`, duration_seconds: 5,
    seed: 42, steps: 4, audio_mode: 'silent',
    idempotency_key: `p15b-${key}-${shot}`.slice(0, 180),
    input_bindings: preflight.input_bindings } };
}

async function createProject(origin: string, title: string): Promise<string> {
  const response = await post(`${origin}/api/projects`, { title,
    script_title: `${title} script`,
    script_content: 'A complete locked script for P1.5B integration tests.' });
  expect(response.status).toBe(201);
  return ((await response.json()) as { data: { id: string } }).data.id;
}

async function createShot(origin: string, project: string,
  ordinal: number): Promise<string> {
  const response = await post(`${origin}/api/projects/${project}/shots`, {
    title: `P1.5B shot ${ordinal}`, scene_id: 'SC-01', duration_seconds: 5,
    shot_size: 'medium', camera_movement: 'locked',
    action: `Shot ${ordinal} crosses frame.`, dialogue: '', sound: '',
    prompt: `Cinematic P1.5B shot ${ordinal}.`, continuity_mode: 'independent',
    h3_prompt_spec: { style: 'Live-action, cinematic',
      anchor: 'a medium shot frames the subject shown in <Picture 1>',
      beats: ['The subject crosses the frame'], soundscape: 'Quiet room tone.',
      lines: [], silent_subjects: [], subjects: [],
      camera: 'The camera holds a static shot', music: 'N/A' },
    continuity_dependencies: [], costume_state: {}, reference_bindings: [],
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { data: { id: string } }).data.id;
}

async function createApprovedImage(origin: string, project: string,
  name: string): Promise<string> {
  const created = await post(`${origin}/api/projects/${project}/assets`, {
    kind: 'image', name, uri: `refs/${crypto.randomUUID()}.png`,
    content_hash: null,
  });
  expect(created.status).toBe(201);
  const id = ((await created.json()) as { data: { id: string } }).data.id;
  expect((await patch(`${origin}/api/projects/${project}/assets`, {
    asset_id: id, status: 'approved',
  })).status).toBe(200);
  return id;
}

async function projectSnapshot(origin: string, project: string) {
  return ((await (await fetch(`${origin}/api/projects/${project}`)).json()) as {
    data: { h3_jobs: unknown[]; shot_plans: Array<Record<string, unknown>> };
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
