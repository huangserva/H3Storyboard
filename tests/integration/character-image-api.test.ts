import {
  CharacterImageJobSchema,
  CharacterSchema,
  ProjectSchema,
  type CharacterImageJob,
} from '../../packages/protocol/src/index.js';
import { openProjectStore, type ProjectStore } from
  '../../packages/project-store/src/index.js';
import { ComfyUIClient } from '../../packages/h3-provider/src/index.js';
import { CharacterImageLeaseWorker, SharedGpuCoordinator } from
  '../../packages/task-engine/src/index.js';
import { createApiServer, type ApiServer } from '../../apps/api/src/server.js';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const servers = new Set<ApiServer>();
const stores = new Set<ProjectStore>();
const directories = new Set<string>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  for (const store of stores) store.close();
  stores.clear();
  await Promise.all([...directories].map((directory) =>
    rm(directory, { recursive: true, force: true })));
  directories.clear();
});

describe('CharacterImageJob HTTP and SQLite integration', () => {
  test('creates an idempotent server-engine job and lists durable state', async () => {
    const fixture = await startFixture();
    const { project, character } = await createProjectCharacter(fixture.origin);
    const url = `${fixture.origin}/api/projects/${project.id}/characters/` +
      `${character.id}/image_jobs`;
    const input = masterInput('master-http-idempotent');

    const first = await postJson(url, input);
    expect(first.status).toBe(201);
    const job = CharacterImageJobSchema.parse(await responseData(first));
    expect(job).toMatchObject({ project_id: project.id,
      character_id: character.id, operation: 'master_t2i',
      provider: 'local_comfyui', engine: 'krea2', status: 'draft',
      lora_name: null });

    const replay = await postJson(url, input);
    expect(replay.status).toBe(201);
    expect(CharacterImageJobSchema.parse(await responseData(replay)).id).toBe(job.id);

    const conflict = await postJson(url, {
      ...input, prompt: 'A changed request using the same key.',
    });
    await expectError(conflict, 409, 'IDEMPOTENCY_KEY_REUSED');

    const listed = await fetch(
      `${fixture.origin}/api/projects/${project.id}/character_image_jobs`);
    expect(listed.status).toBe(200);
    const jobs = (await responseData(listed) as unknown[]).map(
      (value) => CharacterImageJobSchema.parse(value));
    expect(jobs.map(({ id }) => id)).toEqual([job.id]);

    await fixture.server.close();
    servers.delete(fixture.server);
    const restarted = await startApi(fixture.databasePath);
    const afterRestart = await fetch(
      `${restarted.origin}/api/projects/${project.id}/character_image_jobs`);
    expect((await responseData(afterRestart) as Array<{ id: string }>)[0]?.id)
      .toBe(job.id);
  });

  test('enforces server LoRA allowlist, managed engine, source, scope, and lock',
    async () => {
      const denied = await startFixture();
      const { project, character } = await createProjectCharacter(denied.origin);
      const createUrl = `${denied.origin}/api/projects/${project.id}/characters/` +
        `${character.id}/image_jobs`;
      const loraDenied = await postJson(createUrl, {
        ...masterInput('lora-denied-job'),
        lora_profile: 'adult', lora_name: 'not-allowed.safetensors',
        lora_strength: 0.5,
      });
      await expectError(loraDenied, 422, 'CHARACTER_IMAGE_LORA_NOT_ALLOWED');

      const clientEngine = await postJson(createUrl, {
        ...masterInput('client-engine-forbidden'), engine: 'qwen_image_edit_2511',
      });
      await expectError(clientEngine, 422, 'CHARACTER_IMAGE_INPUT_INVALID');

      const store = trackStore(openProjectStore(denied.databasePath));
      const root = seedApprovedRoot(store, project.id, character.id);
      const identity = await postJson(createUrl, identityInput(
        'identity-source-ok', root.reference.id));
      expect(identity.status).toBe(201);
      expect(CharacterImageJobSchema.parse(await responseData(identity)).engine)
        .toBe('qwen_image_edit_2511');

      const foreign = await createProjectCharacter(denied.origin, 'Foreign');
      const crossScope = await postJson(
        `${denied.origin}/api/projects/${foreign.project.id}/characters/` +
          `${character.id}/image_jobs`, masterInput('cross-project-character'));
      await expectError(crossScope, 404, 'CHARACTER_NOT_FOUND');

      const candidate = store.characterMedia.registerUpload(
        project.id, character.id, uploadInput('candidate-source'));
      const badSource = await postJson(createUrl, identityInput(
        'candidate-source-job', candidate.reference.id));
      await expectError(badSource, 422, 'CHARACTER_IMAGE_SOURCE_INVALID');

      const locked = await createProjectCharacter(denied.origin, 'Locked');
      store.production.updateLock(locked.project.id, {
        engaged: true, reason: 'HTTP integration lock',
      });
      const lockedCreate = await postJson(
        `${denied.origin}/api/projects/${locked.project.id}/characters/` +
          `${locked.character.id}/image_jobs`, masterInput('locked-image-job'));
      await expectError(lockedCreate, 409, 'LOCK_ENGAGED');

      const allowed = await startFixture({
        character_image_lora_allowlist: ['allowed.safetensors'],
      });
      const allowedCast = await createProjectCharacter(allowed.origin, 'Allowed');
      const loraAccepted = await postJson(
        `${allowed.origin}/api/projects/${allowedCast.project.id}/characters/` +
          `${allowedCast.character.id}/image_jobs`, {
          ...masterInput('lora-allowed-job'), lora_profile: 'portrait',
          lora_name: 'allowed.safetensors', lora_strength: 0.35,
        });
      expect(loraAccepted.status).toBe(201);
    });

  test('routes cancel through an injected worker callback and retries immutably',
    async () => {
      const directory = await temporaryDirectory();
      const databasePath = join(directory, 'storyboard.db');
      const workerStore = trackStore(openProjectStore(databasePath));
      const client = new ComfyUIClient({ endpoint: 'http://127.0.0.1:1',
        poll_interval_ms: 0, poll_max_attempts: 1 });
      const coordinator = new SharedGpuCoordinator({
        lease_store: workerStore.gpuLeases, gpu_host: 'test-gpu:0',
        queue_clients: [client], managed_free_clients: [], memory_client: client,
        minimum_free_vram_bytes: 0, settle_ms: 0,
      });
      const worker = new CharacterImageLeaseWorker({ store: workerStore, client,
        gpu_coordinator: coordinator, data_directory: directory,
        lease_duration_ms: 120_000 });
      const canceledByWorker: string[] = [];
      const api = await startApi(databasePath, {
        cancel_character_image_job: async (jobId, reason) => {
          canceledByWorker.push(jobId);
          return worker.cancel(jobId, reason);
        },
      });
      const { project, character } = await createProjectCharacter(api.origin);
      const create = await postJson(
        `${api.origin}/api/projects/${project.id}/characters/${character.id}` +
          '/image_jobs', masterInput('cancel-me-job'));
      const original = CharacterImageJobSchema.parse(await responseData(create));

      const canceled = await postJson(
        `${api.origin}/api/projects/${project.id}/character_image_jobs/` +
          `${original.id}/cancel`, { reason: 'Director rejected this draft.' });
      expect(canceled.status).toBe(200);
      expect(CharacterImageJobSchema.parse(await responseData(canceled)))
        .toMatchObject({ status: 'canceled',
          cancel_reason: 'Director rejected this draft.' });
      expect(canceledByWorker).toEqual([original.id]);

      const retryUrl = `${api.origin}/api/projects/${project.id}/` +
        `character_image_jobs/${original.id}/retry`;
      const retried = await postJson(retryUrl, {
        idempotency_key: 'cancel-me-job-retry-001',
      });
      expect(retried.status).toBe(201);
      const retry = CharacterImageJobSchema.parse(await responseData(retried));
      expect(retry).toMatchObject({ status: 'draft', retry_of_job_id: original.id });
      expect(retry.id).not.toBe(original.id);
      const replay = await postJson(retryUrl, {
        idempotency_key: 'cancel-me-job-retry-001',
      });
      expect(replay.status).toBe(201);
      expect(CharacterImageJobSchema.parse(await responseData(replay)).id)
        .toBe(retry.id);

      const other = await createProjectCharacter(api.origin, 'Other');
      const crossCancel = await postJson(
        `${api.origin}/api/projects/${other.project.id}/character_image_jobs/` +
          `${retry.id}/cancel`, { reason: 'Wrong project.' });
      await expectError(crossCancel, 404, 'CHARACTER_IMAGE_JOB_NOT_FOUND');
      expect(canceledByWorker).toEqual([original.id]);

      const invalidRetry = await postJson(
        `${api.origin}/api/projects/${project.id}/character_image_jobs/` +
          `${retry.id}/retry`, { idempotency_key: 'retry-still-draft-job' });
      await expectError(invalidRetry, 409, 'CHARACTER_IMAGE_RETRY_INVALID');
    });

  test('refuses to fake cancellation when the provider-owning worker is absent',
    async () => {
      const fixture = await startFixture();
      const { project, character } = await createProjectCharacter(fixture.origin);
      const create = await postJson(
        `${fixture.origin}/api/projects/${project.id}/characters/${character.id}` +
          '/image_jobs', masterInput('external-worker-cancel'));
      const draft = CharacterImageJobSchema.parse(await responseData(create));
      const store = trackStore(openProjectStore(fixture.databasePath));
      const claimed = store.characterImageJobs.claim(draft.id, 120_000);
      store.characterImageJobs.markSubmitIntent(
        draft.id, claimed.lease_token!, 'external-worker-client');
      store.characterImageJobs.markQueued(
        draft.id, claimed.lease_token!, 'external-worker-prompt');
      store.characterImageJobs.markRunning(draft.id, claimed.lease_token!);

      const canceled = await postJson(
        `${fixture.origin}/api/projects/${project.id}/character_image_jobs/` +
          `${draft.id}/cancel`, { reason: 'No owner is connected.' });
      await expectError(canceled, 503, 'CHARACTER_IMAGE_CANCEL_UNAVAILABLE');
      expect(store.characterImageJobs.get(draft.id)).toMatchObject({
        status: 'running', cancel_reason: null,
        provider_job_id: 'external-worker-prompt',
      });
    });
});

interface ApiOptions {
  character_image_lora_allowlist?: readonly string[];
  cancel_character_image_job?: (
    jobId: string, reason: string,
  ) => Promise<CharacterImageJob>;
}

async function startFixture(options: ApiOptions = {}) {
  const directory = await temporaryDirectory();
  const databasePath = join(directory, 'storyboard.db');
  const api = await startApi(databasePath, options);
  return { ...api, directory, databasePath };
}

async function startApi(databasePath: string, options: ApiOptions = {}) {
  const server = createApiServer({ database_path: databasePath, port: 0, ...options });
  servers.add(server);
  const { origin } = await server.start();
  return { server, origin };
}

async function createProjectCharacter(origin: string, suffix = 'Primary') {
  const project = ProjectSchema.parse(await responseData(await postJson(
    `${origin}/api/projects`, { title: `${suffix} image project`,
      script_title: `${suffix} image script`, script_content:
      'A complete script establishes an HTTP character image integration.' })));
  const character = CharacterSchema.parse(await responseData(await postJson(
    `${origin}/api/projects/${project.id}/characters`, {
      name: `${suffix} actor`, canonical_appearance:
      'An adult actor with stable facial geometry and wardrobe.',
    })));
  return { project, character };
}

function seedApprovedRoot(store: ProjectStore, projectId: string,
  characterId: string) {
  const upload = store.characterMedia.registerUpload(
    projectId, characterId, uploadInput('approved-root'));
  store.characterMedia.approveReference(projectId, characterId,
    upload.reference.id, { make_primary: true });
  return upload;
}

function uploadInput(key: string) {
  return { idempotency_key: key, request_hash: `request-${key}`,
    name: `${key}.png`, relative_path: `characters/${key}.png`,
    content_hash: `sha256:${'a'.repeat(64)}`, derived_from: null };
}

function masterInput(idempotencyKey: string) {
  return { operation: 'master_t2i', prompt: 'Cinematic neutral character portrait.',
    seed: 2026082401, width: 480, height: 864, steps: 8, cfg: 1,
    sampler: 'euler_ancestral', scheduler: 'sgm_uniform', denoise: null,
    lora_profile: null, lora_name: null, lora_strength: null,
    source_reference_ids: [], idempotency_key: idempotencyKey };
}

function identityInput(idempotencyKey: string, referenceId: string) {
  return { ...masterInput(idempotencyKey), operation: 'identity_edit',
    steps: 4, sampler: 'euler', scheduler: 'simple', denoise: 1,
    source_reference_ids: [referenceId] };
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'h3-image-api-'));
  directories.add(directory);
  return directory;
}

function trackStore(store: ProjectStore): ProjectStore {
  stores.add(store);
  return store;
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body) });
}

async function responseData(response: Response): Promise<unknown> {
  const body = await response.json() as { data?: unknown; error?: unknown };
  if (body.data === undefined) throw new Error(
    `Expected data envelope for HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body.data;
}

async function expectError(response: Response, status: number,
  code: string): Promise<void> {
  expect(response.status).toBe(status);
  const body = await response.json() as { error: { code: string; message: string } };
  expect(body.error.code).toBe(code);
  expect(body.error.message.length).toBeGreaterThan(0);
}
