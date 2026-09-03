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

describe('P2.2 plan review HTTP and SQLite integration', () => {
  it('edits, diffs, and atomically approves one active plan set', async () => {
    const fixture = await setupDraftReview('P2.2 approval');
    const initial = await getReview(fixture);
    expect(initial).toMatchObject({
      compilation: { status: 'draft', revision: 0 },
      active_compilation_id: null,
      can_approve: true,
    });
    expect(initial.items).toHaveLength(2);
    expect(initial.items.every(({ source_beats }) => source_beats.length > 0))
      .toBe(true);
    expect(initial.items.map(({ change }) => change.kind))
      .toEqual(['added', 'added']);

    const first = initial.items[0]!;
    await expectError(await patch(reviewRoot(fixture) +
      `/shots/${first.shot_plan.id}`, {
        expected_compilation_revision: 0,
        expected_planning_revision: 0,
        sound: '禁止加入的外部雨声',
      }), 400, 'VALIDATION_FAILED');
    const afterRejectedSound = await getReview(fixture);
    expect(afterRejectedSound.compilation.revision).toBe(0);
    expect(afterRejectedSound.items[0]!.shot_plan).toMatchObject({
      sound: '', planning_revision: 0,
    });
    const editedResponse = await patch(reviewRoot(fixture) +
      `/shots/${first.shot_plan.id}`, {
        expected_compilation_revision: initial.compilation.revision,
        expected_planning_revision: first.shot_plan.planning_revision,
        title: '导演修订 · 雨巷重逢', duration_seconds: 12,
        shot_size: 'close-up', camera_movement: 'slow push-in',
        action: '苏晚宁停在檐下，顾承渊从雨幕中走近。',
        dialogue: '苏晚宁：你还是来了。',
        prompt: 'Locked two-character rainy-night composition.',
        costume_state: { 苏晚宁: '墨绿色旗袍', 顾承渊: '深色长衫' },
        position_state: { 苏晚宁: '檐下左侧', 顾承渊: '雨巷右侧' },
        prop_state: { 油纸伞: '顾承渊右手' },
      });
    expect(editedResponse.status).toBe(200);
    const edited = data<PlanReview>(await editedResponse.json());
    expect(edited.compilation.revision).toBe(1);
    expect(edited.items[0]!.shot_plan).toMatchObject({
      title: '导演修订 · 雨巷重逢', planning_revision: 1,
      planning_status: 'draft', sound: '',
      position_state: { 苏晚宁: '檐下左侧', 顾承渊: '雨巷右侧' },
      prop_state: { 油纸伞: '顾承渊右手' },
      source_script_scene_id: first.shot_plan.source_script_scene_id,
      source_script_beat_ids: first.shot_plan.source_script_beat_ids,
    });
    expect(edited.items[0]!.change).toMatchObject({ kind: 'added' });

    await expectError(await patch(reviewRoot(fixture) +
      `/shots/${first.shot_plan.id}`, {
        expected_compilation_revision: 0,
        expected_planning_revision: 0,
        title: '陈旧标签覆盖',
      }), 409, 'PLAN_REVIEW_CONFLICT');
    const afterStaleEdit = await getReview(fixture);
    expect(afterStaleEdit.compilation.revision).toBe(1);
    expect(afterStaleEdit.items[0]!.shot_plan).toMatchObject({
      title: '导演修订 · 雨巷重逢', planning_revision: 1,
    });
    await expectError(await post(reviewRoot(fixture) + '/approve', {
      expected_revision: 0,
    }), 409, 'PLAN_REVIEW_CONFLICT');
    const afterStaleApproval = await getReview(fixture);
    expect(afterStaleApproval.compilation).toMatchObject({
      status: 'draft', revision: 1,
    });

    const approvedResponse = await post(reviewRoot(fixture) + '/approve', {
      expected_revision: edited.compilation.revision,
    });
    expect(approvedResponse.status).toBe(200);
    const approved = data<PlanReview>(await approvedResponse.json());
    expect(approved).toMatchObject({
      compilation: { status: 'approved', revision: 2 },
      active_compilation_id: edited.compilation.id,
      can_approve: false,
    });
    expect(approved.items.every(({ shot_plan }) =>
      shot_plan.planning_status === 'approved')).toBe(true);

    const snapshot = data<ProjectSnapshot>(await (await fetch(
      `${fixture.origin}/api/projects/${fixture.project}`)).json());
    expect(snapshot.project.active_script_compilation_id)
      .toBe(approved.compilation.id);
    expect(snapshot.shot_plans.find(({ id }) => id === fixture.historical.id))
      .toMatchObject({ planning_status: 'superseded',
        action: fixture.historical.action });
    expect(snapshot.shot_plans.filter(({ source_compilation_id }) =>
      source_compilation_id === approved.compilation.id).every(
      ({ planning_status }) => planning_status === 'approved')).toBe(true);

    await expectError(await patch(reviewRoot(fixture) +
      `/shots/${approved.items[0]!.shot_plan.id}`, {
        expected_compilation_revision: approved.compilation.revision,
        expected_planning_revision:
          approved.items[0]!.shot_plan.planning_revision,
        title: '批准后禁止修改',
      }), 409, 'PLAN_REVIEW_IMMUTABLE');

    await prepareGenerationContext(fixture,
      approved.items[0]!.shot_plan.id);
    const preflight = data<{ ready: boolean; mode: string;
      input_bindings: unknown[]; blocking_error: { code: string } | null }>(
      await (await fetch(`${fixture.origin}/api/projects/${fixture.project}` +
        `/shots/${approved.items[0]!.shot_plan.id}/jobs/preflight`)).json());
    expect(preflight).toMatchObject({ ready: true, blocking_error: null });
    const createdJob = await post(`${fixture.origin}/api/shots/` +
      `${approved.items[0]!.shot_plan.id}/jobs`, h3JobInput(
        preflight.mode, preflight.input_bindings,
        `p22-approved-${crypto.randomUUID()}`));
    expect(createdJob.status).toBe(201);
    expect(data<{ shot_plan_id: string }>(await createdJob.json()).shot_plan_id)
      .toBe(approved.items[0]!.shot_plan.id);

    const replay = await post(reviewRoot(fixture) + '/approve', {
      expected_revision: edited.compilation.revision,
    });
    expect(replay.status).toBe(200);
    expect(data<PlanReview>(await replay.json()).compilation.id)
      .toBe(approved.compilation.id);
    await expectError(await post(reviewRoot(fixture) + '/approve', {
      expected_revision: 999,
    }), 409, 'PLAN_REVIEW_CONFLICT');
  });

  it('rolls back approval and converges concurrent approval requests', async () => {
    const fixture = await setupDraftReview('P2.2 rollback');
    const initial = await getReview(fixture);
    const database = new Database(fixture.databasePath);
    try {
      database.exec(`CREATE TRIGGER fail_plan_set_switch
        BEFORE UPDATE OF active_script_compilation_id ON projects
        BEGIN SELECT RAISE(ABORT, 'forced plan set switch failure'); END`);
    } finally { database.close(); }

    await expectError(await post(reviewRoot(fixture) + '/approve', {
      expected_revision: initial.compilation.revision,
    }), 500, 'INTERNAL_ERROR');
    const rolledBack = await getReview(fixture);
    expect(rolledBack.compilation.status).toBe('draft');
    expect(rolledBack.active_compilation_id).toBeNull();
    expect(rolledBack.items.every(({ shot_plan }) =>
      shot_plan.planning_status === 'draft')).toBe(true);
    const afterFailure = data<ProjectSnapshot>(await (await fetch(
      `${fixture.origin}/api/projects/${fixture.project}`)).json());
    expect(afterFailure.shot_plans.find(({ id }) => id === fixture.historical.id))
      .toMatchObject({ planning_status: 'approved' });

    const writable = new Database(fixture.databasePath);
    try { writable.exec('DROP TRIGGER fail_plan_set_switch'); }
    finally { writable.close(); }
    const approvals = await Promise.all([1, 2].map(() => post(
      reviewRoot(fixture) + '/approve', {
        expected_revision: initial.compilation.revision,
      })));
    expect(approvals.map(({ status }) => status)).toEqual([200, 200]);
    const ids = await Promise.all(approvals.map(async (response) =>
      data<PlanReview>(await response.json()).compilation.id));
    expect(new Set(ids)).toEqual(new Set([initial.compilation.id]));
    const audit = new Database(fixture.databasePath, { readonly: true });
    try {
      expect(audit.prepare(`SELECT COUNT(*) AS count FROM script_compilations
        WHERE project_id = ? AND status = 'approved'`).get(fixture.project))
        .toEqual({ count: 1 });
    } finally { audit.close(); }
  });

  it('diffs the next script plan set against the active approved plan set',
    async () => {
      const fixture = await setupDraftReview('P2.2 diff');
      const firstReview = await getReview(fixture);
      const firstApproved = data<PlanReview>(await (await post(
        reviewRoot(fixture) + '/approve', {
          expected_revision: firstReview.compilation.revision,
        })).json());
      const firstPlanContent = firstApproved.items.map(
        ({ shot_plan }) => planContent(shot_plan));
      const nextImport = await post(
        `${fixture.origin}/api/projects/${fixture.project}/scripts/import`, {
          format: 'plain_text', title: 'P2.2 diff V3', content: [
            'SC-01 雨巷 夜',
            '苏晚宁转过身，望向雨幕。',
            '苏晚宁：你终于来了。',
          ].join('\n'),
        });
      const nextDocument = data<{ version: { id: string; revision: number } }>(
        await nextImport.json());
      expect((await post(`${fixture.origin}/api/projects/${fixture.project}` +
        `/scripts/${nextDocument.version.id}/lock`, {
          expected_revision: nextDocument.version.revision,
        })).status).toBe(200);
      expect((await post(`${fixture.origin}/api/projects/${fixture.project}` +
        `/scripts/${nextDocument.version.id}/compile`, {
          idempotency_key: `p22-diff-${crypto.randomUUID()}`,
        })).status).toBe(201);
      const nextFixture = { ...fixture, script: nextDocument.version.id };
      const nextReview = await getReview(nextFixture);
      expect(nextReview.active_compilation_id).toBe(firstApproved.compilation.id);
      expect(nextReview.items[0]!.change).toMatchObject({
        kind: 'changed',
        baseline_shot_plan_id: firstApproved.items[0]!.shot_plan.id,
      });
      expect(nextReview.items[0]!.change.changed_fields).toContain('action');
      expect(nextReview.removed_shot_plans).toHaveLength(1);
      expect(nextReview.removed_shot_plans[0]!.id)
        .toBe(firstApproved.items[1]!.shot_plan.id);

      const nextApproved = data<PlanReview>(await (await post(
        reviewRoot(nextFixture) + '/approve', {
          expected_revision: nextReview.compilation.revision,
        })).json());
      const snapshot = data<ProjectSnapshot>(await (await fetch(
        `${fixture.origin}/api/projects/${fixture.project}`)).json());
      expect(snapshot.project.active_script_compilation_id)
        .toBe(nextApproved.compilation.id);
      expect(snapshot.shot_plans.filter(({ source_compilation_id }) =>
        source_compilation_id === firstApproved.compilation.id).map((shot) => ({
          planning_status: shot.planning_status, content: planContent(shot),
        }))).toEqual(firstPlanContent.map((content) => ({
          planning_status: 'superseded', content,
        })));
      const audit = new Database(fixture.databasePath, { readonly: true });
      try {
        expect(audit.prepare(`SELECT status FROM script_compilations
          WHERE id = ?`).get(firstApproved.compilation.id))
          .toEqual({ status: 'superseded' });
      } finally { audit.close(); }

      const laterImport = await post(
        `${fixture.origin}/api/projects/${fixture.project}/scripts/import`, {
          format: 'plain_text', title: 'P2.2 diff V4',
          content: 'SC-01 雨巷 夜\n苏晚宁走进雨幕。',
        });
      const later = data<{ version: { id: string; revision: number } }>(
        await laterImport.json());
      expect((await post(`${fixture.origin}/api/projects/${fixture.project}` +
        `/scripts/${later.version.id}/lock`, {
          expected_revision: later.version.revision,
        })).status).toBe(200);
      const approvalReplay = await post(reviewRoot(nextFixture) + '/approve', {
        expected_revision: nextReview.compilation.revision,
      });
      expect(approvalReplay.status).toBe(200);
      expect(data<PlanReview>(await approvalReplay.json()).compilation.id)
        .toBe(nextApproved.compilation.id);
    });

  it('replays old jobs but blocks new retries after their plan is superseded',
    async () => {
      const fixture = await setupDraftReview('P2.2 job safety');
      await prepareGenerationContext(fixture, fixture.historical.id);
      const preflight = data<{ mode: string; input_bindings: unknown[] }>(
        await (await fetch(`${fixture.origin}/api/projects/${fixture.project}` +
          `/shots/${fixture.historical.id}/jobs/preflight`)).json());
      const idempotencyKey = `p22-old-job-${crypto.randomUUID()}`;
      const input = h3JobInput(preflight.mode, preflight.input_bindings,
        idempotencyKey);
      const createdResponse = await post(`${fixture.origin}/api/shots/` +
        `${fixture.historical.id}/jobs`, input);
      expect(createdResponse.status).toBe(201);
      const created = data<{ id: string }>(await createdResponse.json());
      const writable = new Database(fixture.databasePath);
      try {
        writable.prepare(`UPDATE h3_jobs SET status = 'failed',
          error_code = 'TEST_FAILURE', error_message = 'retry boundary',
          completed_at = ?, updated_at = ? WHERE id = ?`).run(
          new Date().toISOString(), new Date().toISOString(), created.id);
      } finally { writable.close(); }
      expect((await put(`${fixture.origin}/api/projects/${fixture.project}` +
        '/generation_lock', { engaged: false })).status).toBe(200);
      const review = await getReview(fixture);
      expect((await post(reviewRoot(fixture) + '/approve', {
        expected_revision: review.compilation.revision,
      })).status).toBe(200);

      const replay = await post(`${fixture.origin}/api/shots/` +
        `${fixture.historical.id}/jobs`, input);
      expect(replay.status).toBe(201);
      expect(data<{ id: string }>(await replay.json()).id).toBe(created.id);
      await expectError(await post(`${fixture.origin}/api/projects/` +
        `${fixture.project}/h3_jobs/${created.id}/retry`, {
          idempotency_key: `p22-blocked-retry-${crypto.randomUUID()}`,
        }), 409, 'SHOT_PLAN_DRAFT');
      const snapshot = data<ProjectSnapshot>(await (await fetch(
        `${fixture.origin}/api/projects/${fixture.project}`)).json());
      expect(snapshot.h3_jobs).toHaveLength(1);
    });

  it('refuses approval when immutable Scene/Beat provenance is incomplete',
    async () => {
      const fixture = await setupDraftReview('P2.2 provenance');
      const initial = await getReview(fixture);
      const writable = new Database(fixture.databasePath);
      try {
        writable.prepare(`UPDATE shot_plans SET source_script_beat_ids_json = ?
          WHERE id = ?`).run(JSON.stringify([crypto.randomUUID()]),
          initial.items[0]!.shot_plan.id);
      } finally { writable.close(); }
      const corrupted = await getReview(fixture);
      expect(corrupted.can_approve).toBe(false);
      await expectError(await post(reviewRoot(fixture) + '/approve', {
        expected_revision: corrupted.compilation.revision,
      }), 422, 'PLAN_REVIEW_INCOMPLETE');
      const snapshot = data<ProjectSnapshot>(await (await fetch(
        `${fixture.origin}/api/projects/${fixture.project}`)).json());
      expect(snapshot.project.active_script_compilation_id).toBeNull();
      expect(snapshot.shot_plans.find(({ id }) => id === fixture.historical.id))
        .toMatchObject({ planning_status: 'approved',
          action: fixture.historical.action });
      expect(snapshot.shot_plans.filter(({ source_compilation_id }) =>
        source_compilation_id === initial.compilation.id).every(
        ({ planning_status }) => planning_status === 'draft')).toBe(true);
      const audit = new Database(fixture.databasePath, { readonly: true });
      try {
        expect(audit.prepare(`SELECT status, revision FROM script_compilations
          WHERE id = ?`).get(initial.compilation.id)).toEqual({
            status: 'draft', revision: 0,
          });
      } finally { audit.close(); }
    });
});

interface PlanReview {
  compilation: { id: string; status: string; revision: number };
  active_compilation_id: string | null;
  can_approve: boolean;
  items: Array<{ shot_plan: ShotPlan; source_beats: unknown[];
    change: { kind: string; changed_fields: string[];
      baseline_shot_plan_id: string | null } }>;
  removed_shot_plans: ShotPlan[];
}
interface ShotPlan {
  id: string; planning_status: string; planning_revision: number;
  title: string; duration_seconds: number; shot_size: string;
  camera_movement: string; action: string; dialogue: string; sound: string;
  prompt: string; costume_state: Record<string, string>;
  position_state: Record<string, string>; prop_state: Record<string, string>;
  source_script_scene_id: string | null; source_script_beat_ids: string[];
  source_compilation_id: string | null;
}
interface ProjectSnapshot {
  project: { active_script_compilation_id: string | null };
  shot_plans: ShotPlan[];
  h3_jobs: unknown[];
}
interface Fixture {
  origin: string; databasePath: string; project: string; script: string;
  historical: { id: string; action: string };
}

async function setupDraftReview(title: string): Promise<Fixture> {
  const api = await startApi();
  const project = await createProject(api.origin, title);
  const historicalResponse = await post(
    `${api.origin}/api/projects/${project}/shots`, shotPlanInput());
  const historical = data<{ id: string; action: string }>(
    await historicalResponse.json());
  const importedResponse = await post(
    `${api.origin}/api/projects/${project}/scripts/import`, {
      format: 'plain_text', title: `${title} V2`, content: [
        'SC-01 雨巷 夜',
        '苏晚宁停在檐下。',
        '苏晚宁：你终于来了。',
        'SC-02 厢房 凌晨',
        '顾承渊把油纸伞靠在门边。',
      ].join('\n'),
    });
  const imported = data<{ version: { id: string; revision: number } }>(
    await importedResponse.json());
  expect((await post(`${api.origin}/api/projects/${project}/scripts/` +
    `${imported.version.id}/lock`, {
      expected_revision: imported.version.revision,
    })).status).toBe(200);
  const compiled = await post(`${api.origin}/api/projects/${project}/scripts/` +
    `${imported.version.id}/compile`, {
      idempotency_key: `p22-compile-${crypto.randomUUID()}`,
    });
  expect(compiled.status).toBe(201);
  return { origin: api.origin, databasePath: api.databasePath, project,
    script: imported.version.id, historical };
}

function reviewRoot(fixture: Fixture): string {
  return `${fixture.origin}/api/projects/${fixture.project}/scripts/` +
    `${fixture.script}/plan_review`;
}
async function getReview(fixture: Fixture): Promise<PlanReview> {
  const response = await fetch(reviewRoot(fixture));
  expect(response.status).toBe(200);
  return data<PlanReview>(await response.json());
}
async function startApi() {
  const directory = await mkdtemp(join(tmpdir(), 'h3-p22-'));
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
    script_content: 'A complete locked legacy script for P2.2 integration.' });
  expect(response.status).toBe(201);
  return data<{ id: string }>(await response.json()).id;
}
function shotPlanInput() {
  return { title: 'V1 现行分镜', scene_id: 'LEGACY-SC-01',
    duration_seconds: 6, shot_size: 'medium', camera_movement: 'locked',
    action: '旧计划中的人物在门边停下。', dialogue: '', sound: '', prompt: '',
    continuity_mode: 'independent', continuity_dependencies: [],
    costume_state: {}, position_state: {}, prop_state: {},
    reference_bindings: [], semantic_references: [], opening_state: null,
    ending_state: null };
}
function planContent(shot: ShotPlan) {
  return { title: shot.title, duration_seconds: shot.duration_seconds,
    shot_size: shot.shot_size, camera_movement: shot.camera_movement,
    action: shot.action, dialogue: shot.dialogue, sound: shot.sound,
    prompt: shot.prompt, costume_state: shot.costume_state,
    position_state: shot.position_state,
    prop_state: shot.prop_state,
  };
}
async function prepareGenerationContext(fixture: Fixture,
  shotPlanId: string): Promise<void> {
  expect((await patch(`${fixture.origin}/api/shots/${shotPlanId}`, {
    h3_prompt_spec: { style: 'Live-action, cinematic',
        anchor: 'a medium shot frames the subject shown in <Picture 1>',
        beats: ['The subject crosses the frame'], soundscape: 'Quiet room tone.',
        lines: [], silent_subjects: [], subjects: [],
        camera: 'The camera holds a static shot', music: 'N/A' }, })).status).toBe(200);
  expect((await post(`${fixture.origin}/api/modes`, {
    key: 'p22-review-mode', title: 'P2.2 Review Mode',
    description: 'Verified i2v mode for plan approval integration.',
    capability_declaration: {
      generation_modes: ['i2v'], duration_seconds: { min: 4, max: 15 },
      resolution: { min_width: 480, max_width: 480,
        min_height: 864, max_height: 864 },
      lora_profile_requirements: [],
      provider_requirements: ['local_comfyui'], extensions: {},
    },
  })).status).toBe(201);
  const assetResponse = await post(`${fixture.origin}/api/projects/` +
    `${fixture.project}/assets`, {
      kind: 'image', uri: `references/${fixture.project}.png`,
      content_hash: null,
    });
  expect(assetResponse.status).toBe(201);
  const asset = data<{ id: string }>(await assetResponse.json());
  expect((await patch(`${fixture.origin}/api/projects/${fixture.project}/assets`, {
    asset_id: asset.id, status: 'approved',
  })).status).toBe(200);
  expect((await post(`${fixture.origin}/api/projects/${fixture.project}` +
    `/shots/${shotPlanId}/bindings`, {
      binding_type: 'semantic', purpose: 'first_frame',
      target: { type: 'asset', asset_id: asset.id },
    })).status).toBe(200);
  expect((await post(`${fixture.origin}/api/projects/${fixture.project}` +
    '/manifests', {})).status).toBe(201);
  expect((await post(`${fixture.origin}/api/projects/${fixture.project}` +
    '/briefs', {
      mode_key: 'p22-review-mode', body: {
        logline: 'A P2.2 approved plan enters the H3 production chain.',
        style_notes: 'Controlled cinematic integration.', text_style_lock: null,
        hard_rules: ['H3 native audio or silence only.'],
      },
    })).status).toBe(201);
  expect((await put(`${fixture.origin}/api/projects/${fixture.project}` +
    '/generation_lock', {
      engaged: true, reason: 'P2.2 approved-plan integration',
    })).status).toBe(200);
}
function h3JobInput(mode: string, inputBindings: unknown[],
  idempotencyKey: string) {
  return { mode, provider: 'local_comfyui', model: 'H3-local',
    prompt: 'P2.2 approved plan H3 generation request.', duration_seconds: 6,
    seed: 419, steps: 20, audio_mode: 'silent',
    idempotency_key: idempotencyKey, input_bindings: inputBindings };
}
function data<T>(body: unknown): T { return (body as { data: T }).data; }
function request(url: string, method: string, body: unknown): Promise<Response> {
  return fetch(url, { method, headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body) });
}
function post(url: string, body: unknown): Promise<Response> {
  return request(url, 'POST', body);
}
function patch(url: string, body: unknown): Promise<Response> {
  return request(url, 'PATCH', body);
}
function put(url: string, body: unknown): Promise<Response> {
  return request(url, 'PUT', body);
}
async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}
