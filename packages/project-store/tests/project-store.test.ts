import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectStore, StoreError } from '../src/index.js';

const stores: ProjectStore[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function newStore(): ProjectStore {
  const store = new ProjectStore(':memory:');
  stores.push(store);
  return store;
}

function createProject(store: ProjectStore, title = '雨夜归途') {
  const project = store.createProject({
    title,
    script_title: '完整剧本 v1',
    script_content: '雨落在站台上。阿澄走出末班车，远处的灯依次熄灭。',
  });
  seedProductionContext(store, project.id);
  return project;
}

function seedProductionContext(store: ProjectStore, projectId: string): void {
  if (!store.modes.list().some(({ key }) => key === 'test-production')) {
    store.modes.create({ key: 'test-production', title: 'Test Production',
      description: 'Production policy used by store integration tests.',
      capability_declaration: testCapability() });
  }
  const asset = store.createAsset(projectId, { kind: 'image',
    uri: `context/${projectId}.png`, content_hash: null });
  store.updateAsset(projectId, { asset_id: asset.id, status: 'approved' });
  store.freezeCurrentAssetsManifest(projectId);
  store.production.createBrief(projectId, { mode_key: 'test-production',
    body: { logline: 'Test intent', style_notes: 'Stable integration style.',
      text_style_lock: null, hard_rules: ['Preserve planned and actual records.'] } });
  store.production.updateLock(projectId,
    { engaged: true, reason: 'Store integration test' });
}

function testCapability() {
  return { generation_modes: ['t2v', 'i2v', 'fl2v', 'r2v'] as const,
    duration_seconds: { min: 2, max: 15 }, resolution: { min_width: 480,
      max_width: 480, min_height: 864, max_height: 864 },
    lora_profile_requirements: [], provider_requirements: ['local_comfyui'] as const,
    extensions: {} };
}

function createShot(store: ProjectStore, projectId: string, title = '站台') {
  return store.createShotPlan(projectId, {
    title,
    scene_id: 'SC-001',
    duration_seconds: 6,
    shot_size: '中景',
    camera_movement: '缓慢推进',
    action: '阿澄下车并回头看向空站台。',
    dialogue: '',
    sound: '雨声与远处列车制动声',
    prompt: 'cinematic rainy station, slow dolly in',
    continuity_mode: 'independent',
    continuity_dependencies: [],
    costume_state: { 阿澄: '深色雨衣' },
    reference_bindings: [],
  });
}

function completeJob(
  store: ProjectStore,
  shotPlanId: string,
  outputAssetId: string,
  idempotencyKey: string,
) {
  const draft = store.createH3Job(shotPlanId, {
    mode: 't2v',
    provider: 'local_comfyui',
    model: 'H3-local',
    prompt: 'rainy station, cinematic motion',
    duration_seconds: 6,
    seed: 42,
    steps: 28,
    idempotency_key: idempotencyKey,
    input_bindings: [],
    gate_override_reason: 'Store integration repeated generation.',
  });
  const claimed = store.claimH3Job(draft.id);
  expect(claimed.attempt).toBe(1);
  expect(claimed.lease_token).not.toBeNull();
  const leaseToken = claimed.lease_token!;
  store.markH3JobQueued(draft.id, leaseToken, `provider-${idempotencyKey}`);
  store.markH3JobRunning(draft.id, leaseToken);
  return store.completeH3Job(draft.id, leaseToken, outputAssetId);
}

describe('ProjectStore', () => {
  it('applies migrations and rewrites legacy continuity asset ids', () => {
    const directory = mkdtempSync(join(tmpdir(), 'h3-store-'));
    directories.push(directory);
    const databasePath = join(directory, 'project.db');
    const first = new ProjectStore(databasePath);
    stores.push(first);
    const project = createProject(first);
    const sourceShot = createShot(first, project.id);
    const output = first.createAsset(project.id, {
      kind: 'video',
      name: 'legacy-source.mp4',
      relative_path: 'outputs/legacy-source.mp4',
      content_hash: 'sha256:legacy-source',
    });
    const job = completeJob(first, sourceShot.id, output.id, 'legacy-source');
    const take = first.createShotActual(sourceShot.id, {
      job_id: job.id,
      output_asset_id: output.id,
      observed_description: 'Legacy approved source take.',
      deviation_notes: '',
      qc_verdict: 'pending',
    });
    first.reviewShotActual(take.id, { qc_verdict: 'approved' });
    const boundary = first.createAsset(project.id, {
      kind: 'image',
      name: 'legacy-last-frame.png',
      relative_path: 'outputs/legacy-last-frame.png',
      content_hash: 'sha256:legacy-last-frame',
      derived_from_asset_id: output.id,
      derivation_kind: 'last_frame',
    });
    first.production.updateLock(project.id, { engaged: false });
    first.updateAsset(project.id, { asset_id: boundary.id, status: 'approved' });
    first.freezeCurrentAssetsManifest(project.id);
    first.production.updateLock(project.id, {
      engaged: true,
      reason: 'Store integration test',
    });
    const continued = first.createShotPlan(project.id, {
      ...createShotInput('Legacy continued shot'),
      continuity_mode: 'visual_match',
      continuity_dependencies: [
        {
          source_shot_plan_id: sourceShot.id,
          source_take_id: take.id,
          reference_asset_id: boundary.id,
          boundary: 'last_frame',
        },
      ],
      reference_bindings: [
        {
          asset_id: boundary.id,
          asset_kind: 'image',
          role: 'first_frame',
          ordinal: 0,
        },
      ],
      semantic_references: [{ purpose: 'first_frame',
        target: { type: 'asset', asset_id: boundary.id } }],
    });
    const legacyContinuedJob = first.createH3Job(continued.id, {
      mode: 'i2v',
      provider: 'local_comfyui',
      model: 'H3-local',
      prompt: 'Legacy continued generation request.',
      duration_seconds: 7,
      seed: 12,
      steps: 20,
      idempotency_key: 'legacy-continued-job',
      input_bindings: continued.reference_bindings,
    });
    const activeDraft = first.createH3Job(sourceShot.id, {
      mode: 't2v',
      provider: 'local_comfyui',
      model: 'H3-local',
      prompt: 'Legacy active work before lease tokens existed.',
      duration_seconds: 6,
      seed: 7,
      steps: 20,
      idempotency_key: 'legacy-active-job',
      input_bindings: [],
      gate_override_reason: 'Store integration repeated generation.',
    });
    const activeClaim = first.claimH3Job(activeDraft.id);
    first.markH3JobQueued(
      activeDraft.id,
      activeClaim.lease_token!,
      'legacy-provider-job',
    );
    first.markH3JobRunning(activeDraft.id, activeClaim.lease_token!);
    first.close();
    stores.splice(stores.indexOf(first), 1);

    const raw = new Database(databasePath);
    raw.prepare(`UPDATE shot_plans SET semantic_references_json = '[]'
      WHERE id = ?`).run(continued.id);
    raw.prepare('DELETE FROM schema_version WHERE version = 13').run();
    const stored = raw
      .prepare(
        `SELECT continuity_dependencies_json FROM shot_plans WHERE id = ?`,
      )
      .get(continued.id) as { continuity_dependencies_json: string };
    const legacyDependencies = (
      JSON.parse(stored.continuity_dependencies_json) as Array<
        Record<string, unknown>
      >
    ).map((dependency) => ({
      source_shot_plan_id: dependency.source_shot_plan_id,
      source_take_id: dependency.source_take_id,
      source_asset_id: output.id,
    }));
    raw.prepare(
      `UPDATE shot_plans
       SET continuity_dependencies_json = ?, reference_bindings_json = '[]'
       WHERE id = ?`,
    ).run(JSON.stringify(legacyDependencies), continued.id);
    raw.exec(`
      DROP INDEX idx_jobs_output_asset;
      DROP INDEX idx_assets_producer_job;
      DROP INDEX idx_jobs_lease;
      ALTER TABLE assets DROP COLUMN producer_job_id;
      ALTER TABLE h3_jobs DROP COLUMN lease_token;
      DELETE FROM schema_version WHERE version >= 3;
    `);
    const version = raw
      .prepare('SELECT MAX(version) AS version FROM schema_version')
      .get() as { version: number };
    raw.close();
    expect(version.version).toBe(2);

    try {
      const unexpected = new ProjectStore(databasePath);
      unexpected.close();
      throw new Error('Expected incompatible legacy job migration to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(StoreError);
      expect((error as StoreError).code).toBe('DATABASE_RECORD_INVALID');
    }
    const repair = new Database(databasePath);
    repair.prepare(
      `UPDATE h3_jobs SET mode = 'v2v', input_bindings_json = ? WHERE id = ?`,
    ).run(
      JSON.stringify([
        {
          asset_id: output.id,
          asset_kind: 'video',
          role: 'motion',
          ordinal: 0,
        },
      ]),
      legacyContinuedJob.id,
    );
    repair.close();

    const reopened = new ProjectStore(databasePath);
    stores.push(reopened);
    const snapshot = reopened.getProjectSnapshot(project.id);
    expect(snapshot.script_version.status).toBe('locked');
    expect(snapshot.shot_plans).toHaveLength(2);
    expect(
      snapshot.shot_plans[1]?.continuity_dependencies[0]?.reference_asset_id,
    ).toBe(output.id);
    expect(
      snapshot.shot_plans[1]?.continuity_dependencies[0]?.boundary,
    ).toBe('full_video');
    expect(snapshot.shot_plans[1]?.reference_bindings).toEqual([
      {
        asset_id: output.id,
        asset_kind: 'video',
        role: 'motion',
        ordinal: 0,
      },
    ]);
    expect(
      snapshot.assets.find(({ id }) => id === output.id)?.producer_job_id,
    ).toBe(job.id);
    expect(
      snapshot.h3_jobs.find(({ id }) => id === activeDraft.id)?.status,
    ).toBe('timed_out');
    expect(
      snapshot.h3_jobs.find(({ id }) => id === legacyContinuedJob.id)
        ?.input_bindings,
    ).toEqual(snapshot.shot_plans[1]?.reference_bindings);
    expect(snapshot.shot_plans[1]?.semantic_references).toEqual([]);
    expect(
      reopened
        .listH3JobEvents(activeDraft.id)
        .map(({ to_status }) => to_status),
    ).toEqual(['draft', 'submitting', 'queued', 'running', 'timed_out']);
    const migratedVersion = new Database(databasePath, { readonly: true });
    expect(
      (migratedVersion
        .prepare('SELECT MAX(version) AS version FROM schema_version')
        .get() as { version: number }).version,
    ).toBe(14);
    migratedVersion.close();
  });

  it('backfills legacy image bindings into semantic references in migration v13', () => {
    const directory = mkdtempSync(join(tmpdir(), 'h3-store-v13-'));
    directories.push(directory);
    const databasePath = join(directory, 'project.db');
    const first = new ProjectStore(databasePath);
    const project = first.createProject({ title: 'Legacy image binding',
      script_title: 'Legacy binding script', script_content:
        'A complete legacy script has a first-frame binding before semantic references.' });
    const image = first.createAsset(project.id, { kind: 'image',
      uri: 'references/legacy-first.png', content_hash: null });
    const shot = first.createShotPlan(project.id, {
      ...createShotInput('Legacy image shot'),
      reference_bindings: [{ asset_id: image.id, asset_kind: 'image',
        role: 'first_frame', ordinal: 0 }],
    });
    first.close();
    const raw = new Database(databasePath);
    raw.prepare(`UPDATE shot_plans SET semantic_references_json = '[]'
      WHERE id = ?`).run(shot.id);
    raw.prepare('DELETE FROM schema_version WHERE version = 13').run();
    raw.close();

    const reopened = new ProjectStore(databasePath);
    stores.push(reopened);
    expect(reopened.getProjectSnapshot(project.id).shot_plans[0]
      ?.semantic_references).toEqual([{ purpose: 'first_frame',
        target: { type: 'asset', asset_id: image.id } }]);
  });

  it('keeps every generated attempt and reviews a take only once', () => {
    const store = newStore();
    const project = createProject(store);
    const shot = createShot(store, project.id);
    const firstOutput = store.createAsset(project.id, {
      kind: 'video',
      name: 'take-1.mp4',
      relative_path: 'outputs/take-1.mp4',
      content_hash: 'sha256:first',
    });
    const firstJob = completeJob(
      store,
      shot.id,
      firstOutput.id,
      'shot-1-attempt-1',
    );
    const sameJob = store.createH3Job(shot.id, {
      mode: 't2v',
      provider: 'local_comfyui',
      model: 'H3-local',
      prompt: 'rainy station, cinematic motion',
      duration_seconds: 6,
      seed: 42,
      steps: 28,
      idempotency_key: 'shot-1-attempt-1',
      input_bindings: [],
      gate_override_reason: 'Store integration repeated generation.',
    });
    expect(sameJob.id).toBe(firstJob.id);
    try {
      store.createH3Job(shot.id, {
        mode: 't2v',
        provider: 'local_comfyui',
        model: 'changed-model',
        prompt: 'rainy station, cinematic motion',
        duration_seconds: 6,
        seed: 42,
        steps: 28,
        idempotency_key: 'shot-1-attempt-1',
        input_bindings: [],
        gate_override_reason: 'Store integration repeated generation.',
      });
      throw new Error('Expected conflicting idempotency input to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(StoreError);
      expect((error as StoreError).code).toBe('IDEMPOTENCY_KEY_REUSED');
    }

    const firstActual = store.createShotActual(shot.id, {
      job_id: firstJob.id,
      output_asset_id: firstOutput.id,
      observed_description: '人物在站台中央停下。',
      deviation_notes: '',
      qc_verdict: 'pending',
    });
    const approved = store.reviewShotActual(firstActual.id, {
      qc_verdict: 'approved',
    });
    expect(approved.qc_verdict).toBe('approved');

    const secondOutput = store.createAsset(project.id, {
      kind: 'video',
      name: 'take-2.mp4',
      relative_path: 'outputs/take-2.mp4',
      content_hash: 'sha256:second',
    });
    const secondJob = completeJob(
      store,
      shot.id,
      secondOutput.id,
      'shot-1-attempt-2',
    );
    const secondActual = store.createShotActual(shot.id, {
      job_id: secondJob.id,
      output_asset_id: secondOutput.id,
      observed_description: '人物走出画面。',
      deviation_notes: '动作方向与计划不同',
      qc_verdict: 'pending',
    });

    const snapshot = store.getProjectSnapshot(project.id);
    expect(secondActual.attempt_number).toBe(2);
    expect(snapshot.shot_actuals.map((take) => take.qc_verdict)).toEqual([
      'approved',
      'pending',
    ]);
    expect(() =>
      store.reviewShotActual(firstActual.id, { qc_verdict: 'rejected' }),
    ).toThrowError(StoreError);
  });

  it('rejects a v4 job that reused its input video as its output', () => {
    const directory = mkdtempSync(join(tmpdir(), 'h3-store-v4-'));
    directories.push(directory);
    const databasePath = join(directory, 'project.db');
    const first = new ProjectStore(databasePath);
    stores.push(first);
    const project = createProject(first);
    const shot = createShot(first, project.id);
    const input = first.createAsset(project.id, {
      kind: 'video',
      name: 'legacy-input.mp4',
      relative_path: 'refs/legacy-input.mp4',
      content_hash: 'sha256:legacy-input',
    });
    const job = first.createH3Job(shot.id, {
      mode: 'v2v',
      provider: 'local_comfyui',
      model: 'H3-local',
      prompt: 'A legacy job with invalid output lineage.',
      duration_seconds: 6,
      seed: 5,
      steps: 20,
      idempotency_key: 'legacy-self-output',
      input_bindings: [
        {
          asset_id: input.id,
          asset_kind: 'video',
          role: 'motion',
          ordinal: 0,
        },
      ],
    });
    const claim = first.claimH3Job(job.id);
    first.markH3JobQueued(job.id, claim.lease_token!, 'legacy-self-output');
    first.markH3JobRunning(job.id, claim.lease_token!);
    first.close();
    stores.splice(stores.indexOf(first), 1);

    const raw = new Database(databasePath);
    const now = new Date().toISOString();
    raw.prepare(
      `UPDATE h3_jobs
       SET status = 'completed', output_asset_id = ?, completed_at = ?,
           updated_at = ?, lease_token = NULL, lease_expires_at = NULL
       WHERE id = ?`,
    ).run(input.id, now, now, job.id);
    raw.exec(`
      DROP INDEX idx_jobs_output_asset;
      DROP INDEX idx_assets_producer_job;
      ALTER TABLE assets DROP COLUMN producer_job_id;
      DELETE FROM schema_version WHERE version = 5;
    `);
    raw.close();

    try {
      const unexpected = new ProjectStore(databasePath);
      unexpected.close();
      throw new Error('Expected invalid v4 output lineage to fail migration');
    } catch (error) {
      expect(error).toBeInstanceOf(StoreError);
      expect((error as StoreError).code).toBe('DATABASE_RECORD_INVALID');
    }
  });

  it('accepts continuity only from an approved take in the same project', () => {
    const store = newStore();
    const project = createProject(store);
    const sourceShot = createShot(store, project.id, '源镜头');
    const output = store.createAsset(project.id, {
      kind: 'video',
      name: 'approved.mp4',
      relative_path: 'outputs/approved.mp4',
      content_hash: 'sha256:approved',
    });
    const job = completeJob(store, sourceShot.id, output.id, 'approved-source');
    const take = store.createShotActual(sourceShot.id, {
      job_id: job.id,
      output_asset_id: output.id,
      observed_description: '人物面向画面右侧。',
      deviation_notes: '',
      qc_verdict: 'pending',
    });
    const boundaryFrame = store.createAsset(project.id, {
      kind: 'image',
      name: 'approved-last-frame.png',
      relative_path: 'outputs/approved-last-frame.png',
      content_hash: 'sha256:approved-last-frame',
      derived_from_asset_id: output.id,
      derivation_kind: 'last_frame',
    });
    store.production.updateLock(project.id, { engaged: false });
    store.updateAsset(project.id, {
      asset_id: boundaryFrame.id,
      status: 'approved',
    });
    store.freezeCurrentAssetsManifest(project.id);
    store.production.updateLock(project.id, {
      engaged: true,
      reason: 'Store integration test',
    });

    expect(() =>
      store.createShotPlan(project.id, {
        ...createShotInput('连续镜头'),
        continuity_mode: 'visual_match',
        continuity_dependencies: [
          {
            source_shot_plan_id: sourceShot.id,
            source_take_id: take.id,
            reference_asset_id: boundaryFrame.id,
            boundary: 'last_frame',
          },
        ],
        reference_bindings: [
          {
            asset_id: boundaryFrame.id,
            asset_kind: 'image',
            role: 'first_frame',
            ordinal: 0,
          },
        ],
      }),
    ).toThrowError(StoreError);

    store.reviewShotActual(take.id, { qc_verdict: 'approved' });
    const continued = store.createShotPlan(project.id, {
      ...createShotInput('连续镜头'),
      continuity_mode: 'visual_match',
      continuity_dependencies: [
        {
          source_shot_plan_id: sourceShot.id,
          source_take_id: take.id,
          reference_asset_id: boundaryFrame.id,
          boundary: 'last_frame',
        },
      ],
      reference_bindings: [
        {
          asset_id: boundaryFrame.id,
          asset_kind: 'image',
          role: 'first_frame',
          ordinal: 0,
        },
      ],
    });
    store.production.updateLock(project.id, { engaged: false });
    store.updateShotPlan({ shot_plan_id: continued.id, semantic_references: [{
      purpose: 'first_frame', target: { type: 'asset', asset_id: boundaryFrame.id },
    }] });
    store.production.updateLock(project.id, {
      engaged: true,
      reason: 'Store integration test',
    });
    expect(continued.continuity_dependencies[0]?.source_take_id).toBe(take.id);
    expect(() =>
      store.createH3Job(continued.id, {
        mode: 't2v',
        provider: 'local_comfyui',
        model: 'H3-local',
        prompt: 'This request incorrectly drops the continuity frame.',
        duration_seconds: 7,
        seed: 42,
        steps: 28,
        idempotency_key: 'continued-without-frame',
        input_bindings: [],
      }),
    ).toThrowError(StoreError);
    const continuedJob = store.createH3Job(continued.id, {
      mode: 'i2v',
      provider: 'local_comfyui',
      model: 'H3-local',
      prompt: 'Continue from the approved boundary frame.',
      duration_seconds: 7,
      seed: 42,
      steps: 28,
      idempotency_key: 'continued-with-frame',
      input_bindings: continued.reference_bindings,
    });
    expect(continuedJob.input_bindings).toEqual(continued.reference_bindings);
  });

  it('rejects H3 assets from another project with a stable code', () => {
    const store = newStore();
    const first = createProject(store, '项目 A');
    const second = createProject(store, '项目 B');
    const foreignAsset = store.createAsset(first.id, {
      kind: 'image',
      name: 'first.png',
      relative_path: 'refs/first.png',
      content_hash: 'sha256:image',
    });
    const shot = createShot(store, second.id);

    try {
      store.createH3Job(shot.id, {
        mode: 'i2v',
        provider: 'minimax_api',
        model: 'H3',
        prompt: 'animate the first frame',
        duration_seconds: 6,
        seed: null,
        steps: 24,
        idempotency_key: 'foreign-asset-attempt',
        input_bindings: [
          {
            asset_id: foreignAsset.id,
            asset_kind: 'image',
            role: 'first_frame',
            ordinal: 0,
          },
        ],
      });
      throw new Error('Expected createH3Job to reject a foreign asset');
    } catch (error) {
      expect(error).toBeInstanceOf(StoreError);
      expect((error as StoreError).code).toBe('ASSET_PROJECT_MISMATCH');
    }
  });
});

function createShotInput(title: string) {
  return {
    title,
    scene_id: 'SC-002',
    duration_seconds: 7,
    shot_size: '近景',
    camera_movement: '横移',
    action: '人物继续向出口移动。',
    dialogue: '',
    sound: '脚步声',
    prompt: 'continue the approved visual direction',
    costume_state: { 阿澄: '深色雨衣' },
    reference_bindings: [],
  };
}
