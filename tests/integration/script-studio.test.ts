import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
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

describe('P2.1 Script Studio HTTP and SQLite integration', () => {
  it('imports, edits, validates, locks, and compiles a structured script',
    async () => {
      const api = await startApi();
      const project = await createProject(api.origin, 'P2 structured script');
      const historicalResponse = await post(
        `${api.origin}/api/projects/${project}/shots`, shotPlanInput());
      expect(historicalResponse.status).toBe(201);
      const historical = data<{ id: string; planning_status: string;
        script_version_id: string; action: string; updated_at: string;
        position_state: Record<string, string>;
        prop_state: Record<string, string> }>(
        await historicalResponse.json());
      const importedResponse = await post(
        `${api.origin}/api/projects/${project}/scripts/import`, {
          format: 'shuohao_novel_script',
          title: '雨夜来信 V2',
          content: JSON.stringify(shuohaoFixture()),
        });
      expect(importedResponse.status).toBe(201);
      const imported = data<ScriptDocument>(await importedResponse.json());
      expect(imported.version).toMatchObject({ version: 2, status: 'draft',
        source_format: 'shuohao_novel_script' });
      expect(imported.scenes.map(({ scene_key }) => scene_key))
        .toEqual(['E01-S01', 'E01-S02']);
      expect(imported.scenes.flatMap(({ beats }) => beats)).toHaveLength(5);
      expect(new Set(imported.scenes.flatMap(({ beats }) => beats.map(({ id }) => id)))
        .size).toBe(5);

      const firstScene = imported.scenes[0]!;
      const firstBeat = firstScene.beats[0]!;
      const editedScenes = imported.scenes.map((scene) => scene.id === firstScene.id
        ? { ...scene, beats: scene.beats.map((beat) => beat.id === firstBeat.id
          ? { ...beat, character_refs: ['苏晚宁'],
            costume_state: { 苏晚宁: '墨绿色旗袍' },
            position_state: { 苏晚宁: '厢房门边' },
            prop_state: { 油纸伞: '靠在门边' } }
          : beat) }
        : scene);
      const savedResponse = await put(
        `${api.origin}/api/projects/${project}/scripts/${imported.version.id}`, {
          expected_revision: imported.version.revision,
          title: imported.version.title,
          scenes: editedScenes,
        });
      expect(savedResponse.status).toBe(200);
      const saved = data<ScriptDocument>(await savedResponse.json());
      expect(saved.scenes[0]!.beats[0]).toMatchObject({
        id: firstBeat.id,
        costume_state: { 苏晚宁: '墨绿色旗袍' },
        position_state: { 苏晚宁: '厢房门边' },
        prop_state: { 油纸伞: '靠在门边' },
      });

      const validationResponse = await post(
        `${api.origin}/api/projects/${project}/scripts/${imported.version.id}/validate`,
        {});
      expect(validationResponse.status).toBe(200);
      expect(data<Validation>(await validationResponse.json())).toMatchObject({
        valid: true,
        statistics: { scene_count: 2, beat_count: 5,
          estimated_duration_seconds: 15 },
      });

      const lockedResponse = await post(
        `${api.origin}/api/projects/${project}/scripts/${imported.version.id}/lock`,
        { expected_revision: saved.version.revision });
      expect(lockedResponse.status).toBe(200);
      const locked = data<ScriptDocument>(await lockedResponse.json());
      expect(locked.version.status).toBe('locked');
      const versionsResponse = await fetch(
        `${api.origin}/api/projects/${project}/scripts`);
      const versions = data<Array<{ id: string; status: string }>>(
        await versionsResponse.json());
      expect(versions).toEqual([
        expect.objectContaining({ id: imported.version.id, status: 'locked' }),
        expect.objectContaining({ status: 'superseded' }),
      ]);

      const compileUrl = `${api.origin}/api/projects/${project}/scripts/` +
        `${imported.version.id}/compile`;
      const compiledResponse = await post(compileUrl, {
        idempotency_key: 'p21-rain-night-compile-0001',
      });
      expect(compiledResponse.status).toBe(201);
      const compiled = data<CompilationResult>(await compiledResponse.json());
      expect(compiled.compilation).toMatchObject({
        script_version_id: imported.version.id,
        idempotency_key: 'p21-rain-night-compile-0001',
        shot_count: 2,
      });
      expect(compiled.shot_plans).toHaveLength(2);
      expect(compiled.shot_plans.every(({ planning_status, sound,
        source_script_scene_id, source_script_beat_ids }) =>
        planning_status === 'draft' && sound === '' &&
        typeof source_script_scene_id === 'string' &&
        source_script_beat_ids.length > 0)).toBe(true);
      expect(compiled.shot_plans[0]!.costume_state)
        .toEqual({ 苏晚宁: '墨绿色旗袍' });
      expect(compiled.shot_plans[0]!.position_state)
        .toEqual({ 苏晚宁: '厢房门边' });
      expect(compiled.shot_plans[0]!.prop_state)
        .toEqual({ 油纸伞: '靠在门边' });

      const replayResponse = await post(compileUrl, {
        idempotency_key: 'p21-rain-night-compile-0001',
      });
      expect(replayResponse.status).toBe(201);
      expect(data<CompilationResult>(await replayResponse.json()).shot_plans
        .map(({ id }) => id)).toEqual(compiled.shot_plans.map(({ id }) => id));
      await expectError(await post(compileUrl, {
        idempotency_key: 'p21-rain-night-compile-other',
      }), 409, 'SCRIPT_COMPILATION_CONFLICT');

      const snapshotResponse = await fetch(
        `${api.origin}/api/projects/${project}`);
      const snapshot = data<{ script_version: { id: string };
        shot_plans: Array<{ id: string; planning_status: string;
          script_version_id: string; action: string; updated_at: string;
          position_state: Record<string, string>;
          prop_state: Record<string, string> }> }>(
        await snapshotResponse.json());
      expect(snapshot.script_version.id).toBe(imported.version.id);
      expect(snapshot.shot_plans.map(({ id }) => id))
        .toEqual([historical.id, ...compiled.shot_plans.map(({ id }) => id)]);
      expect(snapshot.shot_plans[0]).toEqual(expect.objectContaining({
        id: historical.id, planning_status: 'approved',
        script_version_id: historical.script_version_id,
        action: historical.action, updated_at: historical.updated_at,
        position_state: historical.position_state,
        prop_state: historical.prop_state,
      }));
      expect(snapshot.shot_plans.slice(1).every(({ planning_status }) =>
        planning_status === 'draft')).toBe(true);

      const preflight = await fetch(`${api.origin}/api/projects/${project}` +
        `/shots/${compiled.shot_plans[0]!.id}/jobs/preflight`);
      expect(data<{ ready: boolean; blocking_error: { code: string } }>(
        await preflight.json())).toMatchObject({ ready: false,
        blocking_error: { code: 'SHOT_PLAN_DRAFT' } });
      const draftShot = compiled.shot_plans[0]!.id;
      await expectError(await post(`${api.origin}/api/projects/${project}` +
        `/shots/${draftShot}/jobs`, h3JobInput('p21-direct-draft-job')),
      409, 'SHOT_PLAN_DRAFT');
      await expectError(await post(`${api.origin}/api/projects/${project}` +
        '/jobs/batch', { items: [{ shot_plan_id: draftShot,
          job: h3JobInput('p21-batch-draft-job') }] }),
      409, 'SHOT_PLAN_DRAFT');
      const gatedSnapshot = data<{ h3_jobs: unknown[] }>(await (await fetch(
        `${api.origin}/api/projects/${project}`)).json());
      expect(gatedSnapshot.h3_jobs).toEqual([]);

      const database = new Database(api.databasePath, { readonly: true });
      try {
        expect(database.prepare(
          'SELECT MAX(version) AS version FROM schema_version').get())
          .toEqual({ version: 29 });
        expect(database.prepare(
          'SELECT COUNT(*) AS count FROM script_compilations').get())
          .toEqual({ count: 1 });
      } finally { database.close(); }

      const successorResponse = await post(
        `${api.origin}/api/projects/${project}/scripts/import`, {
          format: 'plain_text', title: '雨夜来信 V3',
          content: 'SC-01 清晨\n苏晚宁推开窗，雨已经停了。',
        });
      const successor = data<ScriptDocument>(await successorResponse.json());
      expect((await post(`${api.origin}/api/projects/${project}/scripts/` +
        `${successor.version.id}/lock`, {
          expected_revision: successor.version.revision,
        })).status).toBe(200);
      const supersededReplay = await post(compileUrl, {
        idempotency_key: 'p21-rain-night-compile-0001',
      });
      expect(supersededReplay.status).toBe(201);
      expect(data<CompilationResult>(await supersededReplay.json()).shot_plans
        .map(({ id }) => id)).toEqual(compiled.shot_plans.map(({ id }) => id));
    });

  it('keeps invalid and locked drafts immutable and rolls back failed compilation',
    async () => {
      const api = await startApi();
      const project = await createProject(api.origin, 'P2 error paths');
      const importedResponse = await post(
        `${api.origin}/api/projects/${project}/scripts/import`, {
          format: 'plain_text', title: 'Broken draft',
          content: 'SC-01 厢房 夜\n苏晚宁：今晚别走。',
        });
      const imported = data<ScriptDocument>(await importedResponse.json());
      const invalidScenes = imported.scenes.map((scene) => ({
        ...scene,
        beats: scene.beats.map((beat) => ({ ...beat, duration_seconds: 0.1 })),
      }));
      const invalidResponse = await put(
        `${api.origin}/api/projects/${project}/scripts/${imported.version.id}`, {
          expected_revision: imported.version.revision,
          title: imported.version.title,
          scenes: invalidScenes,
        });
      expect(invalidResponse.status).toBe(200);
      const invalidSaved = data<ScriptDocument>(await invalidResponse.json());
      const lockInvalid = await post(
        `${api.origin}/api/projects/${project}/scripts/${imported.version.id}/lock`,
        { expected_revision: invalidSaved.version.revision });
      await expectError(lockInvalid, 422, 'SCRIPT_VALIDATION_FAILED');

      const repaired = invalidScenes.map((scene) => ({ ...scene,
        beats: scene.beats.map((beat) => ({ ...beat, duration_seconds: 4 })) }));
      const repairedResponse = await put(
        `${api.origin}/api/projects/${project}/scripts/${imported.version.id}`, {
          expected_revision: invalidSaved.version.revision,
          title: imported.version.title, scenes: repaired,
        });
      expect(repairedResponse.status).toBe(200);
      const repairedSaved = data<ScriptDocument>(await repairedResponse.json());
      expect((await post(`${api.origin}/api/projects/${project}/scripts/` +
        `${imported.version.id}/lock`, {
          expected_revision: repairedSaved.version.revision,
        })).status).toBe(200);
      await expectError(await put(`${api.origin}/api/projects/${project}/scripts/` +
        imported.version.id, { expected_revision: repairedSaved.version.revision,
          title: imported.version.title, scenes: repaired }),
      409, 'SCRIPT_VERSION_IMMUTABLE');

      const database = new Database(api.databasePath);
      try {
        database.exec(`CREATE TRIGGER fail_p21_compile BEFORE INSERT ON shot_plans
          BEGIN SELECT RAISE(ABORT, 'forced P2 compile failure'); END`);
      } finally { database.close(); }
      const compile = await post(`${api.origin}/api/projects/${project}/scripts/` +
        `${imported.version.id}/compile`, {
          idempotency_key: 'p21-rollback-compile-0001',
        });
      await expectError(compile, 500, 'INTERNAL_ERROR');
      const audit = new Database(api.databasePath, { readonly: true });
      try {
        expect(audit.prepare(
          'SELECT COUNT(*) AS count FROM script_compilations').get())
          .toEqual({ count: 0 });
        expect(audit.prepare('SELECT COUNT(*) AS count FROM shot_plans').get())
          .toEqual({ count: 0 });
      } finally { audit.close(); }
    });

  it('rejects malformed, concurrent, duplicate, and cross-project script data',
    async () => {
      const api = await startApi();
      const project = await createProject(api.origin, 'P2 input boundaries');
      const foreignProject = await createProject(api.origin, 'P2 foreign project');
      await expectError(await post(
        `${api.origin}/api/projects/${project}/scripts/import`, {
          format: 'shuohao_novel_script', title: 'Malformed', content: '{bad json',
        }), 422, 'SCRIPT_IMPORT_INVALID');

      const importUrl = `${api.origin}/api/projects/${project}/scripts/import`;
      const responses = await Promise.all([
        post(importUrl, { format: 'plain_text', title: 'Draft A',
          content: 'SC-01 夜\n角色甲：第一句对白。' }),
        post(importUrl, { format: 'plain_text', title: 'Draft B',
          content: 'SC-01 夜\n角色乙：第二句对白。' }),
      ]);
      expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
      await expectError(responses.find(({ status }) => status === 409)!,
        409, 'SCRIPT_DRAFT_EXISTS');
      const createdResponse = responses.find(({ status }) => status === 201)!;
      const created = data<ScriptDocument>(await createdResponse.json());
      await expectError(await fetch(`${api.origin}/api/projects/${foreignProject}` +
        `/scripts/${created.version.id}`), 404, 'SCRIPT_VERSION_NOT_FOUND');
      const firstSave = await put(`${api.origin}/api/projects/${project}/scripts/` +
        created.version.id, { expected_revision: created.version.revision,
          title: 'Draft A revised', scenes: created.scenes });
      expect(firstSave.status).toBe(200);
      const firstSaved = data<ScriptDocument>(await firstSave.json());
      await expectError(await put(`${api.origin}/api/projects/${project}/scripts/` +
        created.version.id, { expected_revision: created.version.revision,
          title: 'Stale overwrite', scenes: created.scenes }),
      409, 'SCRIPT_VERSION_CONFLICT');
      await expectError(await post(`${api.origin}/api/projects/${project}/scripts/` +
        `${created.version.id}/lock`, {
          expected_revision: created.version.revision,
        }), 409, 'SCRIPT_VERSION_CONFLICT');
      const afterStale = data<ScriptDocument>(await (await fetch(
        `${api.origin}/api/projects/${project}/scripts/${created.version.id}`)).json());
      expect(afterStale.version).toMatchObject({ title: 'Draft A revised',
        revision: firstSaved.version.revision, status: 'draft' });

      const duplicateScene = { ...created.scenes[0]!, id: crypto.randomUUID(),
        ordinal: 2 };
      await expectError(await put(`${api.origin}/api/projects/${project}/scripts/` +
        created.version.id, { title: created.version.title,
          expected_revision: created.version.revision,
          scenes: [created.scenes[0], duplicateScene] }),
      422, 'SCRIPT_DOCUMENT_INVALID');
      const firstScene = created.scenes[0]!;
      const duplicateBeat = { ...firstScene.beats[0]!, ordinal: 2 };
      await expectError(await put(`${api.origin}/api/projects/${project}/scripts/` +
        created.version.id, { title: created.version.title,
          expected_revision: created.version.revision,
          scenes: [{ ...firstScene, beats: [firstScene.beats[0], duplicateBeat] }] }),
      422, 'SCRIPT_DOCUMENT_INVALID');
      const versions = data<Array<{ status: string }>>(await (await fetch(
        `${api.origin}/api/projects/${project}/scripts`)).json());
      expect(versions.filter(({ status }) => status === 'draft')).toHaveLength(1);
    });
});

interface ScriptBeat {
  id: string;
  duration_seconds: number;
  character_refs: string[];
  costume_state: Record<string, string>;
  position_state: Record<string, string>;
  prop_state: Record<string, string>;
}
interface ScriptScene {
  id: string;
  scene_key: string;
  beats: ScriptBeat[];
}
interface ScriptDocument {
  version: { id: string; title: string; version: number; status: string;
    source_format: string; revision: number };
  scenes: ScriptScene[];
}
interface Validation {
  valid: boolean;
  statistics: { scene_count: number; beat_count: number;
    estimated_duration_seconds: number };
}
interface CompilationResult {
  compilation: { script_version_id: string; idempotency_key: string;
    shot_count: number };
  shot_plans: Array<{ id: string; planning_status: string; sound: string;
    source_script_scene_id: string | null; source_script_beat_ids: string[];
    costume_state: Record<string, string>; position_state: Record<string, string>;
    prop_state: Record<string, string> }>;
}

function shuohaoFixture() {
  return { source: '雨夜来信', episodes: [{ ep: 1, scenes: [
    { sceneId: 'S01', lighting: '油灯暖光', characters: ['苏晚宁', '顾承渊'],
      props: ['油纸伞'], flow: [
        { action: '苏晚宁推开厢房门。' },
        { speaker: '苏晚宁', line: '今晚别走。', delivery: '平静而主动' },
        { action: '顾承渊把伞靠在门边。' },
      ] },
    { sceneId: 'S02', lighting: '清晨冷光', characters: ['苏晚宁'], props: [],
      flow: [
        { action: '苏晚宁推开窗。' },
        { speaker: '苏晚宁', line: '天亮了。', delivery: '很轻' },
      ] },
  ] }] };
}

function shotPlanInput() {
  return { title: 'V1 historical plan', scene_id: 'LEGACY-SC-01',
    duration_seconds: 5, shot_size: 'medium', camera_movement: 'locked',
    action: '历史计划保持原样。', dialogue: '', sound: '', prompt: '',
    continuity_mode: 'independent', continuity_dependencies: [],
    costume_state: {}, position_state: { 顾承渊: '旧计划门边' },
    prop_state: { 油纸伞: '旧计划手中' },
    reference_bindings: [], semantic_references: [],
    opening_state: null, ending_state: null };
}

function h3JobInput(idempotencyKey: string) {
  return { mode: 't2v', provider: 'minimax_api', model: 'H3-test',
    prompt: 'A draft plan must never become an executable H3 job.',
    duration_seconds: 5, seed: 42, steps: 4, audio_mode: 'silent',
    idempotency_key: idempotencyKey, input_bindings: [] };
}

async function startApi() {
  const directory = await mkdtemp(join(tmpdir(), 'h3-p21-'));
  directories.add(directory);
  const databasePath = join(directory, 'storyboard.db');
  const server = createApiServer({ database_path: databasePath, port: 0 });
  servers.add(server);
  const address = await server.start();
  return { origin: address.origin, databasePath };
}

async function createProject(origin: string, title: string): Promise<string> {
  const response = await post(`${origin}/api/projects`, { title,
    script_title: `${title} V1`,
    script_content: 'A sufficiently long initial locked script for P2 integration.' });
  expect(response.status).toBe(201);
  return data<{ id: string }>(await response.json()).id;
}

function data<T>(body: unknown): T {
  return (body as { data: T }).data;
}

function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body) });
}

function put(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body) });
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}
