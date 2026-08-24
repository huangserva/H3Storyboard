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

describe('durable H3 job leases', () => {
  it('automatically recovers submitting, queued, and running once on restart', () => {
    const { databasePath, store: first } = fileStore();
    const { projectId, shotId } = seedShot(first);
    const submitting = createDraft(first, shotId, 'recover-submitting');
    const submittingClaim = first.claimH3Job(submitting.id);
    const queued = createDraft(first, shotId, 'recover-queued');
    const queuedClaim = first.claimH3Job(queued.id);
    first.markH3JobQueued(queued.id, queuedClaim.lease_token!, 'queued-provider');
    const running = createDraft(first, shotId, 'recover-running');
    const runningClaim = first.claimH3Job(running.id);
    first.markH3JobQueued(running.id, runningClaim.lease_token!, 'running-provider');
    first.markH3JobRunning(running.id, runningClaim.lease_token!);
    const canceled = createDraft(first, shotId, 'stay-canceled');
    first.cancelH3Job(canceled.id);
    first.close();
    stores.splice(stores.indexOf(first), 1);

    expireActiveLeases(databasePath);
    const reopened = track(new ProjectStore(databasePath));
    const statuses = new Map(
      reopened
        .getProjectSnapshot(projectId)
        .h3_jobs.map((job) => [job.id, job.status]),
    );
    expect(statuses.get(submitting.id)).toBe('timed_out');
    expect(statuses.get(queued.id)).toBe('timed_out');
    expect(statuses.get(running.id)).toBe('timed_out');
    expect(statuses.get(canceled.id)).toBe('canceled');
    expect(reopened.recoverExpiredH3Jobs()).toBe(0);

    for (const jobId of [submitting.id, queued.id, running.id]) {
      expect(
        reopened
          .listH3JobEvents(jobId)
          .filter(({ to_status }) => to_status === 'timed_out'),
      ).toHaveLength(1);
    }
    expect(
      reopened
        .listH3JobEvents(canceled.id)
        .filter(({ to_status }) => to_status === 'canceled'),
    ).toHaveLength(1);

    reopened.close();
    stores.splice(stores.indexOf(reopened), 1);
    const secondRestart = track(new ProjectStore(databasePath));
    expect(
      secondRestart
        .listH3JobEvents(running.id)
        .filter(({ to_status }) => to_status === 'timed_out'),
    ).toHaveLength(1);
    const retried = secondRestart.claimH3Job(submitting.id);
    expect(retried.attempt).toBe(2);
    expect(retried.lease_token).not.toBe(submittingClaim.lease_token);
  });

  it('uses lease tokens to reject callbacks from an earlier attempt', () => {
    const store = track(new ProjectStore(':memory:'));
    const { shotId } = seedShot(store);
    const draft = createDraft(store, shotId, 'stale-callback');
    const first = store.claimH3Job(draft.id);
    store.failH3Job(
      draft.id,
      first.lease_token!,
      'PROVIDER_UNAVAILABLE',
      'temporary provider failure',
    );
    const second = store.claimH3Job(draft.id);

    expectStoreCode(
      () =>
        store.markH3JobQueued(
          draft.id,
          first.lease_token!,
          'stale-provider-id',
        ),
      'H3_JOB_LEASE_INVALID',
    );
    expect(
      store.markH3JobQueued(draft.id, second.lease_token!, 'current-provider-id')
        .status,
    ).toBe('queued');
  });

  it('renews only the current lease and preserves unexpired work on restart', () => {
    const { databasePath, store: first } = fileStore();
    const { projectId, shotId } = seedShot(first);
    const draft = createDraft(first, shotId, 'heartbeat-current-lease');
    const claimed = first.claimH3Job(draft.id, 10_000);
    const renewed = first.heartbeatH3Job(
      draft.id,
      claimed.lease_token!,
      120_000,
    );
    expect(Date.parse(renewed.lease_expires_at!)).toBeGreaterThan(
      Date.parse(claimed.lease_expires_at!),
    );
    expectStoreCode(
      () => first.heartbeatH3Job(draft.id, crypto.randomUUID()),
      'H3_JOB_LEASE_INVALID',
    );
    expectStoreCode(
      () => first.heartbeatH3Job(draft.id, claimed.lease_token!, Number.MAX_VALUE),
      'INPUT_INVALID',
    );
    const expiredDraft = createDraft(first, shotId, 'expired-before-recovery');
    const expiredClaim = first.claimH3Job(expiredDraft.id, 60_000);
    const raw = new Database(databasePath);
    raw.prepare('UPDATE h3_jobs SET lease_expires_at = ? WHERE id = ?').run(
      '2000-01-01T00:00:00.000Z',
      expiredDraft.id,
    );
    raw.close();
    expectStoreCode(
      () => first.heartbeatH3Job(expiredDraft.id, expiredClaim.lease_token!),
      'H3_JOB_LEASE_EXPIRED',
    );
    first.close();
    stores.splice(stores.indexOf(first), 1);

    const reopened = track(new ProjectStore(databasePath));
    const persisted = reopened
      .getProjectSnapshot(projectId)
      .h3_jobs.find(({ id }) => id === draft.id);
    expect(persisted?.status).toBe('submitting');
    expect(
      reopened
        .listH3JobEvents(draft.id)
        .map(({ to_status }) => to_status),
    ).toEqual(['draft', 'submitting']);
    reopened.cancelH3Job(draft.id);
    expectStoreCode(
      () => reopened.heartbeatH3Job(draft.id, claimed.lease_token!),
      'H3_JOB_STATUS_INVALID',
    );
    reopened.cancelH3Job(draft.id);
    expect(
      reopened
        .listH3JobEvents(draft.id)
        .map(({ to_status }) => to_status),
    ).toEqual(['draft', 'submitting', 'canceled']);
  });

  it('keeps a unique terminal outcome across two database connections', () => {
    const { databasePath, store: worker } = fileStore();
    const { projectId, shotId } = seedShot(worker);
    const controller = track(new ProjectStore(databasePath));
    const firstOutput = createVideo(worker, projectId, 'cancel-wins');
    const first = runToRunning(worker, shotId, 'cancel-wins');

    expect(controller.cancelH3Job(first.id).status).toBe('canceled');
    expectStoreCode(
      () => worker.completeH3Job(first.id, first.lease_token!, firstOutput.id),
      'H3_JOB_STATUS_INVALID',
    );
    expect(
      worker.getProjectSnapshot(projectId).h3_jobs.find(({ id }) => id === first.id)
        ?.output_asset_id,
    ).toBeNull();

    const secondOutput = createVideo(worker, projectId, 'complete-wins');
    const second = runToRunning(worker, shotId, 'complete-wins');
    expect(
      worker.completeH3Job(second.id, second.lease_token!, secondOutput.id).status,
    ).toBe('completed');
    expectStoreCode(
      () => worker.completeH3Job(second.id, second.lease_token!, secondOutput.id),
      'H3_JOB_STATUS_INVALID',
    );
    expectStoreCode(
      () => controller.cancelH3Job(second.id),
      'H3_JOB_STATUS_INVALID',
    );
    expect(
      controller
        .listH3JobEvents(second.id)
        .map(({ to_status }) => to_status),
    ).toEqual(['draft', 'submitting', 'queued', 'running', 'completed']);

    const third = runToRunning(worker, shotId, 'output-already-claimed');
    expectStoreCode(
      () => worker.completeH3Job(third.id, third.lease_token!, secondOutput.id),
      'OUTPUT_ASSET_ALREADY_CLAIMED',
    );
    expect(
      worker
        .getProjectSnapshot(projectId)
        .assets.find(({ id }) => id === secondOutput.id)?.producer_job_id,
    ).toBe(second.id);

    const inputVideo = createVideo(worker, projectId, 'must-not-be-own-output');
    const selfOutputDraft = worker.createH3Job(shotId, {
      mode: 'v2v',
      provider: 'local_comfyui',
      model: 'H3-local',
      prompt: 'Transform the reference into a distinct generated asset.',
      duration_seconds: 6,
      seed: 8,
      steps: 20,
      idempotency_key: 'input-cannot-be-output',
      gate_override_reason: 'Lineage test requires an additional job.',
      input_bindings: [
        {
          asset_id: inputVideo.id,
          asset_kind: 'video',
          role: 'motion',
          ordinal: 0,
        },
      ],
    });
    const selfOutputClaim = worker.claimH3Job(selfOutputDraft.id);
    worker.markH3JobQueued(
      selfOutputDraft.id,
      selfOutputClaim.lease_token!,
      'self-output-provider',
    );
    worker.markH3JobRunning(selfOutputDraft.id, selfOutputClaim.lease_token!);
    expectStoreCode(
      () =>
        worker.completeH3Job(
          selfOutputDraft.id,
          selfOutputClaim.lease_token!,
          inputVideo.id,
        ),
      'H3_JOB_OUTPUT_MISMATCH',
    );
  });

  it('backs off timed-out jobs without starving fresh drafts and caps retries',
    () => {
      const { databasePath, store } = fileStore();
      const { shotId } = seedShot(store);
      const older = createDraft(store, shotId, 'timed-out-backoff');
      const olderClaim = store.claimH3Job(older.id);
      store.deferH3Job(older.id, olderClaim.lease_token!,
        'H3_COMFY_QUEUE_BUSY', 'Shared GPU is busy');
      const fresh = createDraft(store, shotId, 'fresh-draft-wins');

      const freshClaim = store.claimNextH3Job();
      expect(freshClaim?.id).toBe(fresh.id);
      store.cancelH3Job(fresh.id);
      expect(store.claimNextH3Job()).toBeNull();

      const raw = new Database(databasePath);
      raw.prepare('UPDATE h3_jobs SET updated_at = ? WHERE id = ?')
        .run('2000-01-01T00:00:00.000Z', older.id);
      raw.close();
      const recovered = store.claimNextH3Job();
      expect(recovered).toMatchObject({ id: older.id, attempt: 2 });
      store.deferH3Job(older.id, recovered!.lease_token!,
        'H3_COMFY_QUEUE_BUSY', 'Shared GPU is still busy');

      const capped = new Database(databasePath);
      capped.prepare(`UPDATE h3_jobs SET attempt = 8, updated_at = ?
        WHERE id = ?`).run('2000-01-01T00:00:00.000Z', older.id);
      capped.close();
      expect(store.claimNextH3Job()).toBeNull();
    });

  it('immediately recovers one expired lease then backs off a busy retry', () => {
    const store = track(new ProjectStore(':memory:'));
    const { shotId } = seedShot(store);
    const draft = createDraft(store, shotId, 'expired-then-peer-busy');
    const first = store.claimH3Job(draft.id);
    store.markH3SubmitIntent(draft.id, first.lease_token!, 'expired-client');
    store.deferH3Job(draft.id, first.lease_token!,
      'LEASE_EXPIRED', 'Worker lease expired');

    const recovery = store.claimNextH3Job();
    expect(recovery).toMatchObject({ id: draft.id, attempt: 2 });
    store.deferH3Job(draft.id, recovery!.lease_token!,
      'H3_COMFY_QUEUE_BUSY', 'Peer queue became busy during recovery');

    expect(store.claimNextH3Job()).toBeNull();
  });
});

function fileStore(): { databasePath: string; store: ProjectStore } {
  const directory = mkdtempSync(join(tmpdir(), 'h3-recovery-'));
  directories.push(directory);
  const databasePath = join(directory, 'project.db');
  return { databasePath, store: track(new ProjectStore(databasePath)) };
}

function track(store: ProjectStore): ProjectStore {
  stores.push(store);
  return store;
}

function expireActiveLeases(databasePath: string): void {
  const database = new Database(databasePath);
  database
    .prepare(
      `UPDATE h3_jobs SET lease_expires_at = ?
       WHERE status IN ('submitting', 'queued', 'running')`,
    )
    .run('2000-01-01T00:00:00.000Z');
  database.close();
}

function seedShot(store: ProjectStore): { projectId: string; shotId: string } {
  const project = store.createProject({
    title: 'Lease recovery',
    script_title: 'Locked script',
    script_content: 'A complete script long enough to establish the recovery scene.',
  });
  const shot = store.createShotPlan(project.id, {
    title: 'Recovery shot',
    scene_id: 'SC-01',
    duration_seconds: 6,
    shot_size: 'medium',
    camera_movement: 'locked',
    action: 'The subject waits for the worker to recover.',
    dialogue: '',
    sound: '',
    prompt: 'A stable recovery shot.',
    continuity_mode: 'independent',
    continuity_dependencies: [],
    costume_state: {},
    reference_bindings: [],
  });
  seedProductionContext(store, project.id);
  return { projectId: project.id, shotId: shot.id };
}

function seedProductionContext(store: ProjectStore, projectId: string): void {
  store.modes.create({ key: 'lease-recovery', title: 'Lease Recovery',
    description: 'Production policy used by lease recovery tests.',
    capability_declaration: { generation_modes: ['t2v', 'i2v'],
      duration_seconds: { min: 2, max: 15 }, resolution: { min_width: 480,
        max_width: 480, min_height: 864, max_height: 864 },
      lora_profile_requirements: [], provider_requirements: ['local_comfyui'],
      extensions: {} } });
  const asset = store.createAsset(projectId, { kind: 'image',
    uri: `context/${projectId}.png`, content_hash: null });
  store.updateAsset(projectId, { asset_id: asset.id, status: 'approved' });
  store.freezeCurrentAssetsManifest(projectId);
  store.production.createBrief(projectId, { mode_key: 'lease-recovery',
    body: { logline: 'Lease recovery intent', style_notes: 'Stable test style.',
      text_style_lock: null, hard_rules: ['Recover jobs exactly once.'] } });
  store.production.updateLock(projectId,
    { engaged: true, reason: 'Lease recovery test' });
}

function createDraft(store: ProjectStore, shotId: string, key: string) {
  return store.createH3Job(shotId, {
    mode: 't2v',
    provider: 'local_comfyui',
    model: 'H3-local',
    prompt: 'A durable task.',
    duration_seconds: 6,
    seed: 7,
    steps: 20,
    idempotency_key: key,
    input_bindings: [],
    gate_override_reason: 'Lease recovery requires repeated draft jobs.',
  });
}

function runToRunning(store: ProjectStore, shotId: string, key: string) {
  const job = createDraft(store, shotId, key);
  const claimed = store.claimH3Job(job.id);
  store.markH3JobQueued(job.id, claimed.lease_token!, `provider-${key}`);
  return store.markH3JobRunning(job.id, claimed.lease_token!);
}

function createVideo(store: ProjectStore, projectId: string, name: string) {
  return store.createAsset(projectId, {
    kind: 'video',
    name: `${name}.mp4`,
    relative_path: `outputs/${name}.mp4`,
    content_hash: `sha256:${name}`,
  });
}

function expectStoreCode(callback: () => unknown, code: StoreError['code']): void {
  try {
    callback();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(StoreError);
    expect((error as StoreError).code).toBe(code);
  }
}
