import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CreateH3JobBatchResultSchema,
  H3JobBatchListSchema,
  H3JobBatchSchema,
  RetryH3JobResultSchema,
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

describe('M3 H3 batch orchestration', () => {
  it('persists aggregate progress and retries a failed shot immutably',
    async () => {
      const api = await startApi();
      const fixture = await readyFixture(api.origin, 2);
      const createdResponse = await post(
        `${api.origin}/api/projects/${fixture.project}/jobs/batch`,
        batchBody(fixture.preflights, fixture.shots, 'first'));
      expect(createdResponse.status).toBe(201);
      const created = CreateH3JobBatchResultSchema.parse(
        ((await createdResponse.json()) as { data: unknown }).data);
      expect(created.batch).toMatchObject({
        project_id: fixture.project,
        status: 'pending',
        progress: { total: 2, pending: 2, active: 0, completed: 0,
          attention: 0, progress_percent: 0 },
      });
      expect(created.items.map(({ job }) => job.id)).toEqual(
        created.batch.items.map(({ current_job }) => current_job.id));

      const listed = H3JobBatchListSchema.parse(((await (await fetch(
        `${api.origin}/api/projects/${fixture.project}/job_batches`)).json()) as
          { data: unknown }).data);
      expect(listed.batches.map(({ id }) => id)).toEqual([created.batch.id]);
      const otherProject = await createProject(api.origin,
        `M3 foreign ${crypto.randomUUID()}`);
      await expectError(await fetch(`${api.origin}/api/projects/${otherProject}` +
        `/job_batches/${created.batch.id}`), 404, 'H3_BATCH_NOT_FOUND');
      await expectError(await post(`${api.origin}/api/projects/${otherProject}` +
        `/h3_jobs/${created.items[0]!.job.id}/retry`, {
          idempotency_key: 'm3-cross-project-retry-0001',
        }), 404, 'H3_JOB_NOT_FOUND');

      const original = created.items[0]!.job;
      const store = openProjectStore(api.databasePath);
      try {
        const claimed = store.claimH3Job(original.id);
        store.failH3Job(original.id, claimed.lease_token!,
          'COMFY_EXECUTION_FAILED', 'M3 retry fixture failure');
      } finally { store.close(); }

      const attention = await getBatch(
        api.origin, fixture.project, created.batch.id);
      expect(attention).toMatchObject({ status: 'attention',
        progress: { total: 2, pending: 1, attention: 1, completed: 0 } });
      expect(attention.items[0]).toMatchObject({ retryable: true,
        retry_count: 0, current_job: { id: original.id, status: 'failed' } });

      const failureDatabase = new Database(api.databasePath);
      try { failureDatabase.exec(`CREATE TRIGGER fail_m3_h3_retry
        BEFORE INSERT ON h3_jobs WHEN NEW.retry_of_job_id = '${original.id}'
        BEGIN SELECT RAISE(ABORT, 'forced M3 retry failure'); END`); }
      finally { failureDatabase.close(); }
      await expectError(await post(
        `${api.origin}/api/projects/${fixture.project}/h3_jobs/` +
        `${original.id}/retry`, { idempotency_key: 'm3-retry-rollback-0000' }),
      500, 'INTERNAL_ERROR');
      expect((await getBatch(api.origin, fixture.project, created.batch.id))
        .items[0]!.current_job.id).toBe(original.id);
      const cleanupDatabase = new Database(api.databasePath);
      try { cleanupDatabase.exec('DROP TRIGGER fail_m3_h3_retry'); }
      finally { cleanupDatabase.close(); }

      const retryKey = 'm3-retry-first-shot-0001';
      const [retryResponse, concurrentRetryResponse] = await Promise.all([
        post(`${api.origin}/api/projects/${fixture.project}/h3_jobs/` +
          `${original.id}/retry`, { idempotency_key: retryKey }),
        post(`${api.origin}/api/projects/${fixture.project}/h3_jobs/` +
          `${original.id}/retry`, { idempotency_key: retryKey }),
      ]);
      expect(retryResponse.status).toBe(201);
      expect(concurrentRetryResponse.status).toBe(201);
      const retry = RetryH3JobResultSchema.parse(
        ((await retryResponse.json()) as { data: unknown }).data);
      expect(RetryH3JobResultSchema.parse(
        ((await concurrentRetryResponse.json()) as { data: unknown }).data).job.id)
        .toBe(retry.job.id);
      expect(retry.job).toMatchObject({ retry_of_job_id: original.id,
        idempotency_key: retryKey, status: 'draft', attempt: 0,
        prompt: original.prompt, seed: original.seed,
        audio_mode: original.audio_mode });
      expect(retry.batch).toMatchObject({ id: created.batch.id,
        status: 'pending', progress: { pending: 2, attention: 0 },
        items: expect.arrayContaining([expect.objectContaining({ retry_count: 1,
          current_job: expect.objectContaining({ id: retry.job.id }) })]) });

      const replay = await post(
        `${api.origin}/api/projects/${fixture.project}/h3_jobs/` +
        `${original.id}/retry`, { idempotency_key: retryKey });
      expect(replay.status).toBe(201);
      expect(RetryH3JobResultSchema.parse(
        ((await replay.json()) as { data: unknown }).data).job.id)
        .toBe(retry.job.id);
      await expectError(await post(
        `${api.origin}/api/projects/${fixture.project}/h3_jobs/` +
        `${original.id}/retry`, { idempotency_key: 'm3-retry-conflict-0002' }),
      409, 'H3_JOB_RETRY_INVALID');
      const replayedBatchResponse = await post(
        `${api.origin}/api/projects/${fixture.project}/jobs/batch`,
        batchBody(fixture.preflights, fixture.shots, 'first'));
      expect(replayedBatchResponse.status).toBe(201);
      const replayedBatch = CreateH3JobBatchResultSchema.parse(
        ((await replayedBatchResponse.json()) as { data: unknown }).data);
      expect(replayedBatch.batch.id).toBe(created.batch.id);
      expect(replayedBatch.items.map(({ job }) => job.id)).toEqual(
        created.items.map(({ job }) => job.id));
      const rebatch = await post(
        `${api.origin}/api/projects/${fixture.project}/jobs/batch`, { items: [{
          shot_plan_id: original.shot_plan_id,
          job: { mode: retry.job.mode, provider: retry.job.provider,
            model: retry.job.model, prompt: retry.job.prompt,
            duration_seconds: retry.job.duration_seconds, seed: retry.job.seed,
            steps: retry.job.steps, audio_mode: retry.job.audio_mode,
            idempotency_key: retry.job.idempotency_key,
            input_bindings: retry.job.input_bindings,
            gate_override_reason: retry.job.gate_override_reason },
        }] });
      await expectError(rebatch, 409, 'H3_BATCH_CONFLICT');

      const database = new Database(api.databasePath, { readonly: true });
      try {
        expect(database.prepare(
          'SELECT MAX(version) AS version FROM schema_version').get())
          .toEqual({ version: 29 });
        expect(database.prepare(
          'SELECT COUNT(*) AS count FROM h3_jobs WHERE retry_of_job_id = ?')
          .get(original.id)).toEqual({ count: 1 });
        expect(database.prepare(`SELECT name FROM sqlite_master
          WHERE type = 'table' AND name IN
            ('h3_job_batches', 'h3_job_batch_items') ORDER BY name`).all())
          .toEqual([{ name: 'h3_job_batch_items' },
            { name: 'h3_job_batches' }]);
        expect((database.pragma('table_info(h3_job_batches)') as
          Array<{ name: string }>).map(({ name }) => name))
          .toContain('last_claimed_at');
        expect((database.pragma('index_list(h3_jobs)') as
          Array<{ name: string; unique: number; partial: number }>))
          .toContainEqual(expect.objectContaining({
            name: 'idx_h3_jobs_single_retry', unique: 1, partial: 1,
          }));
      } finally { database.close(); }
    });

  it('derives active, recovering, attention, and completed progress',
    async () => {
      const api = await startApi();
      const fixture = await readyFixture(api.origin, 2);
      const created = await createBatch(api.origin, fixture.project,
        fixture.preflights, fixture.shots, 'progress');
      const firstId = created.items[0]!.job.id;
      const secondId = created.items[1]!.job.id;
      const store = openProjectStore(api.databasePath);
      try {
        const firstClaim = store.claimH3Job(firstId);
        expect(store.getH3JobBatch(fixture.project, created.batch.id))
          .toMatchObject({ status: 'running', progress: {
            pending: 1, active: 1, recovering: 0, completed: 0,
            attention: 0, progress_percent: 0,
          } });
        store.deferH3Job(firstId, firstClaim.lease_token!,
          'H3_COMFY_QUEUE_BUSY', 'Recoverable progress fixture');
        expect(store.getH3JobBatch(fixture.project, created.batch.id))
          .toMatchObject({ status: 'running', progress: {
            pending: 1, active: 0, recovering: 1, completed: 0,
            attention: 0, progress_percent: 0,
          } });
        const resumed = store.claimH3Job(firstId);
        store.failH3Job(firstId, resumed.lease_token!,
          'M3_PROGRESS_FAILURE', 'Attention progress fixture');
        expect(store.getH3JobBatch(fixture.project, created.batch.id))
          .toMatchObject({ status: 'attention', progress: {
            pending: 1, active: 0, recovering: 0, completed: 0,
            attention: 1, progress_percent: 0,
          } });
        const retry = store.retryH3Job(fixture.project, firstId, {
          idempotency_key: 'm3-progress-retry-0001',
        }).job;
        completeStoreJob(store, retry.id, 'progress-first');
        expect(store.getH3JobBatch(fixture.project, created.batch.id))
          .toMatchObject({ status: 'running', progress: {
            pending: 1, completed: 1, attention: 0, progress_percent: 50,
          } });
        completeStoreJob(store, secondId, 'progress-second');
        expect(store.getH3JobBatch(fixture.project, created.batch.id))
          .toMatchObject({ status: 'completed', progress: {
            pending: 0, active: 0, recovering: 0, completed: 2,
            attention: 0, progress_percent: 100,
          } });
      } finally { store.close(); }
    });

  it('enforces retry HTTP validation and terminal-state policy', async () => {
    const api = await startApi();
    const fixture = await readyFixture(api.origin, 2);
    const created = await createBatch(api.origin, fixture.project,
      fixture.preflights, fixture.shots, 'retry-policy');
    const canceledId = created.items[0]!.job.id;
    const completedId = created.items[1]!.job.id;
    await expectError(await post(
      `${api.origin}/api/projects/${fixture.project}/h3_jobs/` +
      `${canceledId}/retry`, { idempotency_key: 'short' }),
    422, 'H3_RETRY_INPUT_INVALID');
    await expectError(await post(
      `${api.origin}/api/projects/${fixture.project}/h3_jobs/` +
      `${crypto.randomUUID()}/retry`, {
        idempotency_key: 'm3-missing-job-retry-0001',
      }), 404, 'H3_JOB_NOT_FOUND');
    await expectError(await post(
      `${api.origin}/api/projects/${fixture.project}/h3_jobs/` +
      `${canceledId}/retry`, { idempotency_key: 'm3-draft-retry-0001' }),
    409, 'H3_JOB_RETRY_INVALID');
    const store = openProjectStore(api.databasePath);
    try {
      store.cancelH3Job(canceledId, 'Canceled retry policy fixture');
      completeStoreJob(store, completedId, 'retry-policy-completed');
    } finally { store.close(); }
    const canceledRetry = await post(
      `${api.origin}/api/projects/${fixture.project}/h3_jobs/` +
      `${canceledId}/retry`, { idempotency_key: 'm3-canceled-retry-0001' });
    expect(canceledRetry.status).toBe(201);
    expect(RetryH3JobResultSchema.parse(
      ((await canceledRetry.json()) as { data: unknown }).data).job)
      .toMatchObject({ status: 'draft', retry_of_job_id: canceledId });
    await expectError(await post(
      `${api.origin}/api/projects/${fixture.project}/h3_jobs/` +
      `${completedId}/retry`, { idempotency_key: 'm3-completed-retry-0001' }),
    409, 'H3_JOB_RETRY_INVALID');
  });

  it('round-robins runnable shots across batches before draining one batch',
    async () => {
      const api = await startApi();
      const fixture = await readyFixture(api.origin, 4);
      const first = await createBatch(api.origin, fixture.project,
        fixture.preflights, fixture.shots.slice(0, 2), 'fair-a');
      const second = await createBatch(api.origin, fixture.project,
        fixture.preflights, fixture.shots.slice(2), 'fair-b');
      const store = openProjectStore(api.databasePath);
      try {
        const firstClaim = store.claimNextH3Job()!;
        expect(first.batch.items.map(({ current_job }) => current_job.id))
          .toContain(firstClaim.id);
        store.failH3Job(firstClaim.id, firstClaim.lease_token!,
          'M3_TEST', 'advance fair scheduler');

        const secondClaim = store.claimNextH3Job()!;
        expect(second.batch.items.map(({ current_job }) => current_job.id))
          .toContain(secondClaim.id);
        store.failH3Job(secondClaim.id, secondClaim.lease_token!,
          'M3_TEST', 'advance fair scheduler');

        const thirdClaim = store.claimNextH3Job()!;
        expect(first.batch.items.map(({ current_job }) => current_job.id))
          .toContain(thirdClaim.id);
      } finally { store.close(); }
    });

  it('uses claim count to break same-millisecond batch cursor ties',
    async () => {
      const api = await startApi();
      const fixture = await readyFixture(api.origin, 4);
      const first = await createBatch(api.origin, fixture.project,
        fixture.preflights, fixture.shots.slice(0, 2), 'millisecond-a');
      const second = await createBatch(api.origin, fixture.project,
        fixture.preflights, fixture.shots.slice(2), 'millisecond-b');
      const database = new Database(api.databasePath);
      try {
        database.prepare(`UPDATE h3_job_batches SET last_claimed_at = ?,
          claimed_count = CASE id WHEN ? THEN 1 ELSE 0 END
          WHERE id IN (?, ?)`).run('2026-08-25T00:00:00.000Z',
          first.batch.id, first.batch.id, second.batch.id);
      } finally { database.close(); }
      const store = openProjectStore(api.databasePath);
      try {
        const claimed = store.claimNextH3Job()!;
        expect(second.items.map(({ job }) => job.id)).toContain(claimed.id);
      } finally { store.close(); }
    });

  it('keeps an unbatched job in the same fair chronological queue',
    async () => {
      const api = await startApi();
      const fixture = await readyFixture(api.origin, 3);
      const batch = await createBatch(api.origin, fixture.project,
        fixture.preflights, fixture.shots.slice(0, 2), 'with-unbatched');
      const unbatchedInput = batchBody(fixture.preflights,
        fixture.shots.slice(2), 'unbatched').items[0]!;
      const store = openProjectStore(api.databasePath);
      try {
        const unbatched = store.createH3Job(
          unbatchedInput.shot_plan_id, unbatchedInput.job);
        const first = store.claimNextH3Job()!;
        expect(batch.items.map(({ job }) => job.id)).toContain(first.id);
        store.failH3Job(first.id, first.lease_token!,
          'M3_UNBATCHED_FAIRNESS', 'Advance batch fairness cursor');
        expect(store.claimNextH3Job()?.id).toBe(unbatched.id);
      } finally { store.close(); }
    });

  it('lists every unfinished batch even beyond completed-history capacity',
    async () => {
      const api = await startApi();
      const fixture = await readyFixture(api.origin, 5);
      const created = [];
      for (let index = 0; index < fixture.shots.length; index += 1) {
        created.push(await createBatch(api.origin, fixture.project,
          fixture.preflights, [fixture.shots[index]!], `visible-${index}`));
      }
      const store = openProjectStore(api.databasePath);
      try {
        const oldestJob = created[0]!.items[0]!.job;
        const claimed = store.claimH3Job(oldestJob.id);
        store.failH3Job(oldestJob.id, claimed.lease_token!,
          'M3_VISIBLE_ATTENTION', 'Old attention batch must remain visible');
      } finally { store.close(); }

      const response = await fetch(
        `${api.origin}/api/projects/${fixture.project}/job_batches`);
      const listed = H3JobBatchListSchema.parse(
        ((await response.json()) as { data: unknown }).data);
      expect(listed.batches).toHaveLength(5);
      expect(new Set(listed.batches.map(({ id }) => id))).toEqual(
        new Set(created.map(({ batch }) => batch.id)));
      expect(listed.batches.find(({ id }) => id === created[0]!.batch.id))
        .toMatchObject({ status: 'attention', progress: { attention: 1 } });
    });

  it('does not let a newer draft batch starve an eligible recovery',
    async () => {
      const api = await startApi();
      const fixture = await readyFixture(api.origin, 2);
      const recoveryBatch = await createBatch(api.origin, fixture.project,
        fixture.preflights, fixture.shots.slice(0, 1), 'recovery-first');
      const store = openProjectStore(api.databasePath);
      try {
        const claimed = store.claimNextH3Job()!;
        expect(recoveryBatch.items.map(({ job }) => job.id)).toContain(claimed.id);
        store.deferH3Job(claimed.id, claimed.lease_token!,
          'H3_COMFY_QUEUE_BUSY', 'eligible recovery fixture');
      } finally { store.close(); }
      await createBatch(api.origin, fixture.project, fixture.preflights,
        fixture.shots.slice(1), 'newer-draft');
      const database = new Database(api.databasePath);
      try {
        database.prepare(`UPDATE h3_jobs SET updated_at = ? WHERE id = ?`)
          .run('2000-01-01T00:00:00.000Z', recoveryBatch.items[0]!.job.id);
        database.prepare(`UPDATE h3_job_batches SET last_claimed_at = ?
          WHERE id = ?`).run('2000-01-01T00:00:00.000Z',
          recoveryBatch.batch.id);
      } finally { database.close(); }
      const resumed = openProjectStore(api.databasePath);
      try {
        expect(resumed.claimNextH3Job()?.id).toBe(
          recoveryBatch.items[0]!.job.id);
      } finally { resumed.close(); }
    });

  it('moves a timed-out provider task to its retry without resubmission risk',
    async () => {
      const api = await startApi();
      const fixture = await readyFixture(api.origin, 1);
      const created = await createBatch(api.origin, fixture.project,
        fixture.preflights, fixture.shots, 'provider-recovery');
      const original = created.items[0]!.job;
      const store = openProjectStore(api.databasePath);
      try {
        const claimed = store.claimH3Job(original.id);
        store.markH3SubmitIntent(original.id, claimed.lease_token!,
          'm3-preserved-client');
        store.markH3JobQueued(original.id, claimed.lease_token!,
          'm3-preserved-provider-task');
        store.markH3JobRunning(original.id, claimed.lease_token!);
        const database = new Database(api.databasePath);
        try { database.prepare(
          'UPDATE h3_jobs SET lease_expires_at = ? WHERE id = ?')
          .run('2000-01-01T00:00:00.000Z', original.id); }
        finally { database.close(); }
        expect(store.recoverExpiredH3Jobs()).toBe(1);
      } finally { store.close(); }

      const response = await post(
        `${api.origin}/api/projects/${fixture.project}/h3_jobs/` +
        `${original.id}/retry`, { idempotency_key: 'm3-provider-recovery-0001' });
      expect(response.status).toBe(201);
      const retried = RetryH3JobResultSchema.parse(
        ((await response.json()) as { data: unknown }).data).job;
      expect(retried).toMatchObject({ retry_of_job_id: original.id,
        status: 'timed_out', attempt: 0,
        provider_job_id: 'm3-preserved-provider-task',
        provider_client_id: 'm3-preserved-client',
        error_code: 'H3_RETRY_PROVIDER_RECOVERY' });

      const resumedStore = openProjectStore(api.databasePath);
      try {
        const claimedRetry = resumedStore.claimNextH3Job();
        expect(claimedRetry).toMatchObject({ id: retried.id,
          status: 'submitting', attempt: 1,
          provider_job_id: 'm3-preserved-provider-task' });
        expect(resumedStore.getH3Job(original.id).status).toBe('timed_out');
        resumedStore.failH3Job(retried.id, claimedRetry!.lease_token!,
          'M3_RECOVERY_FAILED', 'Provider recovery failed after claim');
      } finally { resumedStore.close(); }

      const chainedResponse = await post(
        `${api.origin}/api/projects/${fixture.project}/h3_jobs/` +
        `${retried.id}/retry`, { idempotency_key: 'm3-provider-recovery-0002' });
      expect(chainedResponse.status).toBe(201);
      const chained = RetryH3JobResultSchema.parse(
        ((await chainedResponse.json()) as { data: unknown }).data);
      expect(chained.job).toMatchObject({ retry_of_job_id: retried.id,
        status: 'draft' });
      expect(chained.batch).toMatchObject({ id: created.batch.id,
        items: [expect.objectContaining({ retry_count: 2,
          current_job: expect.objectContaining({ id: chained.job.id }) })] });

      const originalReplay = await post(
        `${api.origin}/api/projects/${fixture.project}/h3_jobs/` +
        `${original.id}/retry`, { idempotency_key: 'm3-provider-recovery-0001' });
      expect(RetryH3JobResultSchema.parse(
        ((await originalReplay.json()) as { data: unknown }).data).batch?.id)
        .toBe(created.batch.id);
    });

  it('upgrades a v22 database with the durable fairness cursor', () => {
    const directory = join(tmpdir(), `h3-m3-upgrade-${crypto.randomUUID()}`);
    directories.add(directory);
    const databasePath = join(directory, 'project.db');
    const initial = openProjectStore(databasePath);
    initial.close();
    const legacy = new Database(databasePath);
    try {
      legacy.exec('ALTER TABLE h3_job_batches DROP COLUMN last_claimed_at');
      legacy.prepare('DELETE FROM schema_version WHERE version = 23').run();
    } finally { legacy.close(); }

    const upgraded = openProjectStore(databasePath);
    upgraded.close();
    const verified = new Database(databasePath, { readonly: true });
    try {
      expect(verified.prepare(
        'SELECT MAX(version) AS version FROM schema_version').get())
        .toEqual({ version: 29 });
      expect((verified.pragma('table_info(h3_job_batches)') as
        Array<{ name: string }>).map(({ name }) => name))
        .toContain('last_claimed_at');
    } finally { verified.close(); }
  });
});

function completeStoreJob(store: ReturnType<typeof openProjectStore>,
  jobId: string, label: string): void {
  const claimed = store.claimH3Job(jobId);
  store.markH3JobQueued(jobId, claimed.lease_token!, `${label}-provider`);
  store.markH3JobRunning(jobId, claimed.lease_token!);
  store.finalizeWorkerOutput(jobId, claimed.lease_token!, {
    name: `${label}.mp4`, relative_path: `outputs/${label}.mp4`,
    content_hash: `sha256:${label === 'progress-first' ? '5' : '6'}` +
      `${label === 'progress-first' ? '5' : '6'}`.repeat(63),
    observed_description: `${label} completed for aggregate progress.`,
  });
}

async function startApi() {
  const directory = await mkdtemp(join(tmpdir(), 'h3-m3-'));
  directories.add(directory);
  const databasePath = join(directory, 'project.db');
  const server = createApiServer({ database_path: databasePath, port: 0 });
  servers.add(server);
  return { ...(await server.start()), databasePath };
}

async function getBatch(origin: string, project: string, batch: string) {
  const response = await fetch(
    `${origin}/api/projects/${project}/job_batches/${batch}`);
  expect(response.status).toBe(200);
  return H3JobBatchSchema.parse(
    ((await response.json()) as { data: unknown }).data);
}

async function createBatch(origin: string, project: string,
  preflights: GenerationPreflightBatch, shots: string[], prefix: string) {
  const response = await post(`${origin}/api/projects/${project}/jobs/batch`,
    batchBody(preflights, shots, prefix));
  expect(response.status).toBe(201);
  return CreateH3JobBatchResultSchema.parse(
    ((await response.json()) as { data: unknown }).data);
}

async function readyFixture(origin: string, count: number) {
  const project = await createProject(origin, `M3 ${crypto.randomUUID()}`);
  const shots: string[] = [];
  for (let ordinal = 1; ordinal <= count; ordinal += 1) {
    shots.push(await createShot(origin, project, ordinal));
  }
  const image = await createApprovedImage(origin, project);
  for (const shot of shots) expect((await post(
    `${origin}/api/projects/${project}/shots/${shot}/bindings`, {
      binding_type: 'semantic', purpose: 'first_frame',
      target: { type: 'asset', asset_id: image },
    })).status).toBe(200);
  const mode = `m3-${crypto.randomUUID().slice(0, 8)}`;
  expect((await post(`${origin}/api/modes`, { key: mode, title: mode,
    description: 'M3 orchestration integration mode.', capability_declaration: {
      generation_modes: ['i2v'], duration_seconds: { min: 4, max: 15 },
      resolution: { min_width: 480, max_width: 480,
        min_height: 864, max_height: 864 }, lora_profile_requirements: [],
      provider_requirements: ['local_comfyui'], extensions: {},
    } })).status).toBe(201);
  expect((await post(`${origin}/api/projects/${project}/manifests`, {})).status)
    .toBe(201);
  expect((await post(`${origin}/api/projects/${project}/briefs`, {
    mode_key: mode, body: { logline: 'M3 batch.', style_notes: 'Cinematic.',
      text_style_lock: null,
      hard_rules: ['H3 native audio or silence only'],
    } })).status).toBe(201);
  expect((await put(`${origin}/api/projects/${project}/generation_lock`, {
    engaged: true, reason: 'M3 orchestration integration',
  })).status).toBe(200);
  const preflights = ((await (await fetch(
    `${origin}/api/projects/${project}/jobs/preflights`)).json()) as
      { data: GenerationPreflightBatch }).data;
  expect(preflights.items.every(({ preflight }) => preflight.ready)).toBe(true);
  return { project, shots, preflights };
}

function batchBody(preflights: GenerationPreflightBatch, shots: string[],
  prefix: string) {
  return { items: shots.map((shot, index) => {
    const preflight = preflights.items.find(
      ({ shot_plan_id }) => shot_plan_id === shot)!.preflight;
    return { shot_plan_id: shot, job: { mode: preflight.mode,
      provider: 'local_comfyui', model: 'H3-local',
      prompt: `M3 generation ${shot}.`, duration_seconds: 5,
      seed: 42, steps: 4, audio_mode: 'silent',
      idempotency_key: `m3-${prefix}-${index}-${shot}`.slice(0, 190),
      input_bindings: preflight.input_bindings } };
  }) };
}

async function createProject(origin: string, title: string) {
  const response = await post(`${origin}/api/projects`, { title,
    script_title: `${title} script`,
    script_content: 'A complete locked script for M3 orchestration tests.' });
  expect(response.status).toBe(201);
  return ((await response.json()) as { data: { id: string } }).data.id;
}

async function createShot(origin: string, project: string, ordinal: number) {
  const response = await post(`${origin}/api/projects/${project}/shots`, {
    title: `M3 shot ${ordinal}`, scene_id: 'SC-01', duration_seconds: 5,
    shot_size: 'medium', camera_movement: 'locked',
    action: `Shot ${ordinal} crosses frame.`, dialogue: '', sound: '',
    prompt: `Cinematic M3 shot ${ordinal}.`, continuity_mode: 'independent',
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

async function createApprovedImage(origin: string, project: string) {
  const created = await post(`${origin}/api/projects/${project}/assets`, {
    kind: 'image', name: 'M3 first frame',
    uri: `refs/${crypto.randomUUID()}.png`, content_hash: null,
  });
  expect(created.status).toBe(201);
  const id = ((await created.json()) as { data: { id: string } }).data.id;
  expect((await patch(`${origin}/api/projects/${project}/assets`, {
    asset_id: id, status: 'approved',
  })).status).toBe(200);
  return id;
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
