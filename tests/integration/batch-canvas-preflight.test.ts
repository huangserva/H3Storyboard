import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiServer, type ApiServer } from '../../apps/api/src/server.js';
import { BatchUpsertCanvasNodesResultSchema, GenerationPreflightBatchSchema,
  type BatchUpsertCanvasNodesResult, type CanvasNode } from
  '../../packages/protocol/src/index.js';

const servers = new Set<ApiServer>();
const directories = new Set<string>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  await Promise.all([...directories].map((directory) =>
    rm(directory, { recursive: true, force: true })));
  directories.clear();
});

describe('batch canvas and generation preflight HTTP contracts', () => {
  it('ensures canvas nodes atomically and idempotently across two API servers',
    async () => {
      const databasePath = await temporaryDatabasePath();
      const first = await startApi(databasePath);
      const project = await createProject(first.origin, 'Batch canvas');
      const firstShot = await createShot(first.origin, project, 1);
      const secondShot = await createShot(first.origin, project, 2);
      const initial = [canvasInput(firstShot, 80), canvasInput(secondShot, 420)];

      const createdResponse = await put(
        `${first.origin}/api/projects/${project}/canvas_nodes`, { nodes: initial });
      expect(createdResponse.status, await createdResponse.clone().text()).toBe(200);
      const created = await batchCanvasBody(createdResponse);
      expect(created.created_count).toBe(2);
      expect(created.updated_count).toBe(0);
      expect(created.canvas_nodes).toHaveLength(2);

      const repeatedResponse = await put(
        `${first.origin}/api/projects/${project}/canvas_nodes`, { nodes: [
          { ...initial[0], x: 999 }, { ...initial[1], x: 1_999 },
        ] });
      expect(repeatedResponse.status).toBe(200);
      const repeated = await batchCanvasBody(repeatedResponse);
      expect(repeated).toMatchObject({ created_count: 0, updated_count: 0 });
      expect(repeated.canvas_nodes.map(({ id }) => id)).toEqual(
        created.canvas_nodes.map(({ id }) => id));
      expect(repeated.canvas_nodes.map(({ x }) => x)).toEqual([80, 420]);

      const migratedResponse = await put(
        `${first.origin}/api/projects/${project}/canvas_nodes`, { nodes: [
          { ...initial[0], x: 120, width: 999, z_index: 999,
            update_position_if_untouched: true },
        ] });
      expect(migratedResponse.status).toBe(200);
      const migrated = await batchCanvasBody(migratedResponse);
      expect(migrated).toMatchObject({ created_count: 0, updated_count: 1 });
      expect(migrated.canvas_nodes.find(({ ref_id }) => ref_id === firstShot))
        .toMatchObject({ x: 120, width: 260, z_index: 0 });
      const staleMigration = await put(
        `${first.origin}/api/projects/${project}/canvas_nodes`, { nodes: [
          { ...initial[0], x: 666, update_position_if_untouched: true },
        ] });
      expect(await batchCanvasBody(staleMigration)).toMatchObject({
        updated_count: 0,
        canvas_nodes: expect.arrayContaining([
          expect.objectContaining({ ref_id: firstShot, x: 120 }),
        ]),
      });

      const untouchedThirdShot = await createShot(first.origin, project, 3);
      const initialThird = canvasInput(untouchedThirdShot, 760);
      await put(`${first.origin}/api/projects/${project}/canvas_nodes`, {
        nodes: [initialThird],
      });
      const layoutMigration = await put(
        `${first.origin}/api/projects/${project}/canvas_nodes`, { nodes: [{
          ...initialThird, x: 800, width: 300, height: 248, z_index: 3,
          update_layout_if_untouched: true,
        }] });
      expect(await batchCanvasBody(layoutMigration)).toMatchObject({
        updated_count: 1,
        canvas_nodes: expect.arrayContaining([expect.objectContaining({
          ref_id: untouchedThirdShot, x: 800, width: 300, height: 248,
          z_index: 3,
        })]),
      });

      const thirdShot = await createShot(first.origin, project, 4);
      const second = await startApi(databasePath);
      const concurrent = await Promise.all(Array.from({ length: 20 }, (_, index) =>
        put(`${index % 2 === 0 ? first.origin : second.origin}` +
          `/api/projects/${project}/canvas_nodes`, {
          nodes: [canvasInput(thirdShot, 760)],
        })));
      expect(concurrent.every(({ status }) => status === 200)).toBe(true);
      const concurrentBodies = await Promise.all(concurrent.map(batchCanvasBody));
      expect(concurrentBodies.reduce((sum, body) => sum + body.created_count, 0))
        .toBe(1);
      const thirdIds = concurrentBodies.map(({ canvas_nodes }) =>
        canvas_nodes.find(({ ref_id }) => ref_id === thirdShot)?.id);
      expect(thirdIds.every((id): id is string => typeof id === 'string'))
        .toBe(true);
      expect(new Set(thirdIds).size).toBe(1);
      const concurrentList = ((await (await fetch(
        `${first.origin}/api/projects/${project}/canvas_nodes`)).json()) as {
          data: CanvasNode[];
        }).data;
      expect(concurrentList.filter(({ ref_id }) => ref_id === thirdShot))
        .toHaveLength(1);

      const foreignProject = await createProject(first.origin, 'Foreign canvas');
      const foreignShot = await createShot(first.origin, foreignProject, 1);
      const fourthShot = await createShot(first.origin, project, 5);
      const duplicate = await put(
        `${first.origin}/api/projects/${project}/canvas_nodes`, { nodes: [
          canvasInput(fourthShot, 1_100), canvasInput(fourthShot, 1_140),
        ] });
      await expectError(duplicate, 400, 'VALIDATION_FAILED');
      const rejected = await put(
        `${first.origin}/api/projects/${project}/canvas_nodes`, { nodes: [
          { ...canvasInput(secondShot, 777), update_position_if_untouched: true },
          canvasInput(fourthShot, 1_100), canvasInput(foreignShot, 1_440),
        ] });
      await expectError(rejected, 422, 'CANVAS_NODE_REF_PROJECT_MISMATCH');
      const listed = await fetch(
        `${first.origin}/api/projects/${project}/canvas_nodes`);
      const listedNodes = ((await listed.json()) as { data: CanvasNode[] }).data;
      expect(listedNodes.some(({ ref_id }) => ref_id === fourthShot)).toBe(false);
      expect(listedNodes.find(({ ref_id }) => ref_id === firstShot)?.x).toBe(120);
      expect(listedNodes.find(({ ref_id }) => ref_id === secondShot)?.x).toBe(420);
    });

  it('returns every project shot preflight in one isolated ordered response',
    async () => {
      const databasePath = await temporaryDatabasePath();
      const api = await startApi(databasePath);
      const project = await createProject(api.origin, 'Batch preflight');
      const readyShot = await createShot(api.origin, project, 1);
      const blockedShot = await createShot(api.origin, project, 2);
      const mode = await createMode(api.origin, 'batch-i2v');
      const asset = await createApprovedImage(api.origin, project);
      await post(`${api.origin}/api/projects/${project}/manifests`, {});
      await patch(`${api.origin}/api/shots/${readyShot}`, {
        semantic_references: [{ purpose: 'first_frame',
          target: { type: 'asset', asset_id: asset } }],
      });
      await post(`${api.origin}/api/projects/${project}/briefs`, {
        mode_key: mode, body: { logline: 'One ready shot and one blocked shot.',
          style_notes: 'Cinematic.', text_style_lock: null, hard_rules: [] },
      });
      await put(`${api.origin}/api/projects/${project}/generation_lock`, {
        engaged: true, reason: 'Batch preflight integration test',
      });

      const response = await fetch(
        `${api.origin}/api/projects/${project}/jobs/preflights`);
      expect(response.status).toBe(200);
      const body = GenerationPreflightBatchSchema.parse(
        ((await response.json()) as { data: unknown }).data);
      expect(body.project_id).toBe(project);
      expect(body.items.map(({ shot_plan_id }) => shot_plan_id))
        .toEqual([readyShot, blockedShot]);
      expect(body.items[0]).toMatchObject({ shot_plan_id: readyShot,
        preflight: { ready: true, blocking_error: null } });
      expect(body.items[1]).toMatchObject({ shot_plan_id: blockedShot,
        preflight: { ready: false,
          blocking_error: { code: 'MODE_CAPABILITY_MISMATCH' } } });

      const missing = await fetch(
        `${api.origin}/api/projects/${crypto.randomUUID()}/jobs/preflights`);
      await expectError(missing, 404, 'PROJECT_NOT_FOUND');
    });

  it('rolls back an earlier insert when SQLite fails during the same batch',
    async () => {
      const databasePath = await temporaryDatabasePath();
      const api = await startApi(databasePath);
      const project = await createProject(api.origin, 'Mid-write rollback');
      const firstShot = await createShot(api.origin, project, 1);
      const failingShot = await createShot(api.origin, project, 2);
      const database = new Database(databasePath);
      try {
        database.exec(`CREATE TRIGGER fail_canvas_batch
          BEFORE INSERT ON canvas_nodes
          WHEN NEW.ref_id = '${failingShot}'
          BEGIN SELECT RAISE(ABORT, 'forced integration failure'); END`);
      } finally {
        database.close();
      }

      const response = await put(
        `${api.origin}/api/projects/${project}/canvas_nodes`, { nodes: [
          canvasInput(firstShot, 80), canvasInput(failingShot, 420),
        ] });
      await expectError(response, 500, 'INTERNAL_ERROR');
      const listed = await fetch(
        `${api.origin}/api/projects/${project}/canvas_nodes`);
      expect(await listed.json()).toEqual({ data: [] });
    });
});

async function batchCanvasBody(
  response: Response): Promise<BatchUpsertCanvasNodesResult> {
  return BatchUpsertCanvasNodesResultSchema.parse(
    ((await response.json()) as { data: unknown }).data);
}

async function temporaryDatabasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'h3-batch-contracts-'));
  directories.add(directory);
  return join(directory, 'project.db');
}

async function startApi(databasePath: string) {
  const server = createApiServer({ database_path: databasePath, port: 0 });
  servers.add(server);
  const address = await server.start();
  return { ...address, server };
}

async function createProject(origin: string, title: string): Promise<string> {
  const response = await post(`${origin}/api/projects`, { title,
    script_title: `${title} script`,
    script_content: 'A complete script for real HTTP and SQLite integration.' });
  expect(response.status).toBe(201);
  return ((await response.json()) as { data: { id: string } }).data.id;
}

async function createShot(origin: string, project: string,
  ordinal: number): Promise<string> {
  const response = await post(`${origin}/api/projects/${project}/shots`, {
    title: `Batch shot ${ordinal}`, scene_id: 'scene-01', duration_seconds: 5,
    shot_size: 'medium', camera_movement: 'locked',
    action: `Shot ${ordinal} crosses the frame.`, dialogue: '', sound: '',
    prompt: `A cinematic batch test shot ${ordinal}.`,
    continuity_mode: 'independent', continuity_dependencies: [],
    costume_state: {}, reference_bindings: [],
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { data: { id: string } }).data.id;
}

function canvasInput(refId: string, x: number) {
  return { node_type: 'shot_plan', ref_id: refId, x, y: 100,
    width: 260, height: 196, z_index: Math.floor(x / 100) };
}

async function createMode(origin: string, key: string): Promise<string> {
  const response = await post(`${origin}/api/modes`, { key, title: key,
    description: 'Batch preflight integration mode.', capability_declaration: {
      generation_modes: ['i2v'], duration_seconds: { min: 4, max: 15 },
      resolution: { min_width: 480, max_width: 480,
        min_height: 864, max_height: 864 }, lora_profile_requirements: [],
      provider_requirements: ['local_comfyui'], extensions: {},
    } });
  expect(response.status).toBe(201);
  return ((await response.json()) as { data: { key: string } }).data.key;
}

async function createApprovedImage(origin: string, project: string) {
  const created = await post(`${origin}/api/projects/${project}/assets`, {
    kind: 'image', name: 'Batch first frame', uri: 'batch/first-frame.png',
    content_hash: null,
  });
  expect(created.status).toBe(201);
  const asset = ((await created.json()) as { data: { id: string } }).data;
  const approved = await patch(`${origin}/api/projects/${project}/assets`, {
    asset_id: asset.id, status: 'approved',
  });
  expect(approved.status).toBe(200);
  return asset.id;
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
