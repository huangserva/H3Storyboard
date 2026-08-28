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

describe('durable character image jobs', () => {
  it('persists immutable source snapshots and enforces idempotency', () => {
    const store = track(new ProjectStore(':memory:'));
    const { projectId, characterId, root } = seedApprovedRoot(store);
    const input = imageJobInput('identity-edit-001', {
      operation: 'identity_edit',
      engine: 'qwen_image_edit_2511',
      denoise: 1,
      source_reference_ids: [root.reference.id],
    });

    const created = store.characterImageJobs.create(
      projectId,
      characterId,
      input,
    );
    expect(created.source_inputs).toEqual([{
      reference_id: root.reference.id,
      asset_id: root.asset.id,
      content_hash: root.asset.content_hash,
    }]);
    expect(store.characterImageJobs.create(projectId, characterId, input).id)
      .toBe(created.id);
    expectStoreCode(() => store.characterImageJobs.create(
      projectId,
      characterId,
      { ...input, prompt: 'A different immutable request.' },
    ), 'IDEMPOTENCY_KEY_REUSED');
  });

  it('rejects candidate, foreign, and non-root variant sources with stable codes', () => {
    const store = track(new ProjectStore(':memory:'));
    const first = seedApprovedRoot(store, 'First');
    const second = seedApprovedRoot(store, 'Second');
    const candidate = store.characterMedia.registerUpload(
      first.projectId,
      first.characterId,
      uploadInput('candidate-source', null),
    );
    expectStoreCode(() => store.characterImageJobs.create(
      first.projectId,
      first.characterId,
      imageJobInput('candidate-source-job', {
        operation: 'identity_edit',
        engine: 'qwen_image_edit_2511',
        denoise: 1,
        source_reference_ids: [candidate.reference.id],
      }),
    ), 'CHARACTER_IMAGE_SOURCE_INVALID');
    expectStoreCode(() => store.characterImageJobs.create(
      first.projectId,
      first.characterId,
      imageJobInput('foreign-source-job', {
        operation: 'identity_edit',
        engine: 'qwen_image_edit_2511',
        denoise: 1,
        source_reference_ids: [second.root.reference.id],
      }),
    ), 'CHARACTER_IMAGE_SOURCE_INVALID');

    const angle = store.characterMedia.registerUpload(
      first.projectId,
      first.characterId,
      uploadInput('approved-angle', first.root.reference.id),
    );
    store.characterMedia.approveReference(
      first.projectId,
      first.characterId,
      angle.reference.id,
      { make_primary: false },
    );
    expectStoreCode(() => store.characterImageJobs.create(
      first.projectId,
      first.characterId,
      imageJobInput('variant-from-angle', {
        operation: 'variant_i2i',
        engine: 'krea2',
        denoise: 0.42,
        source_reference_ids: [angle.reference.id],
      }),
    ), 'CHARACTER_IMAGE_SOURCE_INVALID');
  });

  it('runs the lifecycle and atomically creates candidate output lineage', () => {
    const store = track(new ProjectStore(':memory:'));
    const { projectId, characterId, root } = seedApprovedRoot(store);
    const draft = store.characterImageJobs.create(
      projectId,
      characterId,
      imageJobInput('variant-completion', {
        operation: 'variant_i2i',
        engine: 'krea2',
        denoise: 0.42,
        source_reference_ids: [root.reference.id],
      }),
    );
    const claimed = store.characterImageJobs.claim(draft.id, 120_000);
    const leaseToken = claimed.lease_token!;
    store.characterImageJobs.markSubmitIntent(
      draft.id,
      leaseToken,
      'image-client-001',
    );
    store.characterImageJobs.markQueued(
      draft.id,
      leaseToken,
      'comfy-prompt-001',
    );
    store.characterImageJobs.markRunning(draft.id, leaseToken);
    const result = store.characterImageJobs.finalizeOutput(
      draft.id,
      leaseToken,
      {
        name: 'courier-variant.png',
        relative_path: 'projects/courier/variants/001.png',
        content_hash: `sha256:${'a'.repeat(64)}`,
      },
    );

    expect(result.job.status).toBe('completed');
    expect(result.job.output_asset_id).toBe(result.asset.id);
    expect(result.job.output_reference_id).toBe(result.reference.id);
    expect(result.asset).toMatchObject({
      kind: 'image',
      status: 'candidate',
      producer_image_job_id: draft.id,
    });
    expect(result.reference).toMatchObject({
      asset_id: result.asset.id,
      derived_from: root.reference.id,
    });
    expect(result.asset_derivation).toMatchObject({
      asset_id: result.asset.id,
      source_asset_id: root.asset.id,
      kind: 'variant_i2i',
    });
    expectStoreCode(() => store.updateAsset(projectId, {
      asset_id: result.asset.id,
      content_hash: `sha256:${'e'.repeat(64)}`,
    }), 'ASSET_IMMUTABLE');
    expectStoreCode(() => store.characters.updateReference(
      projectId,
      characterId,
      { reference_id: result.reference.id, derived_from: null },
    ), 'CHARACTER_REFERENCE_IMMUTABLE');
    expect(store.characterImageJobs.listEvents(draft.id)
      .map(({ to_status }) => to_status))
      .toEqual(['draft', 'submitting', 'queued', 'running', 'completed']);
    expectStoreCode(() => store.characterImageJobs.finalizeOutput(
      draft.id,
      leaseToken,
      {
        name: 'late.png',
        relative_path: 'projects/courier/variants/late.png',
        content_hash: `sha256:${'b'.repeat(64)}`,
      },
    ), 'CHARACTER_IMAGE_JOB_STATUS_INVALID');
  });

  it('accepts approved derived angles for Qwen identity editing', () => {
    const store = track(new ProjectStore(':memory:'));
    const { projectId, characterId, root } = seedApprovedRoot(
      store, 'Identity angle');
    const angle = store.characterMedia.registerUpload(projectId, characterId,
      uploadInput('identity-approved-angle', root.reference.id));
    store.characterMedia.approveReference(projectId, characterId,
      angle.reference.id, { make_primary: false });

    const job = store.characterImageJobs.create(projectId, characterId,
      imageJobInput('identity-derived-source', {
        operation: 'identity_edit', engine: 'qwen_image_edit_2511',
        steps: 4, sampler: 'euler', scheduler: 'simple', denoise: 1,
        source_reference_ids: [angle.reference.id],
      }));

    expect(job.source_inputs).toEqual([expect.objectContaining({
      reference_id: angle.reference.id, asset_id: angle.asset.id,
    })]);
    const claimed = store.characterImageJobs.claim(job.id, 120_000);
    store.characterImageJobs.markSubmitIntent(job.id, claimed.lease_token!,
      'identity-derived-client');
    store.characterImageJobs.markQueued(job.id, claimed.lease_token!,
      'identity-derived-provider');
    store.characterImageJobs.markRunning(job.id, claimed.lease_token!);
    const result = store.characterImageJobs.finalizeOutput(
      job.id, claimed.lease_token!, {
        name: 'identity-derived.png',
        relative_path: 'characters/identity-derived.png',
        content_hash: `sha256:${'f'.repeat(64)}`,
      });
    expect(result.reference.derived_from).toBe(root.reference.id);
    expect(result.asset_derivation?.source_asset_id).toBe(root.asset.id);
  });

  it('rolls back asset, reference, derivation, and completion together', () => {
    const { databasePath, store } = fileStore();
    const { projectId, characterId, root } = seedApprovedRoot(store);
    const running = runToRunning(store, projectId, characterId,
      'atomic-output-rollback', root.reference.id);
    const beforeAssets = store.listAssets(projectId).length;
    const raw = new Database(databasePath);
    raw.exec(`CREATE TRIGGER reject_generated_reference
      BEFORE INSERT ON character_references
      BEGIN SELECT RAISE(ABORT, 'forced reference failure'); END;`);
    raw.close();

    expect(() => store.characterImageJobs.finalizeOutput(
      running.id,
      running.lease_token!,
      {
        name: 'must-rollback.png',
        relative_path: 'projects/rollback/output.png',
        content_hash: `sha256:${'c'.repeat(64)}`,
      },
    )).toThrow();
    expect(store.listAssets(projectId)).toHaveLength(beforeAssets);
    expect(store.characterImageJobs.get(running.id)).toMatchObject({
      status: 'running',
      output_asset_id: null,
      output_reference_id: null,
    });
    expect(store.characters.listReferences(projectId, characterId))
      .toHaveLength(1);
  });

  it('refuses completion when a frozen source stops being approved', () => {
    const store = track(new ProjectStore(':memory:'));
    const { projectId, characterId, root } = seedApprovedRoot(store);
    const running = runToRunning(store, projectId, characterId,
      'source-changed-before-completion', root.reference.id);
    store.updateAsset(projectId, {
      asset_id: root.asset.id, status: 'archived',
    });

    expectStoreCode(() => store.characterImageJobs.finalizeOutput(
      running.id,
      running.lease_token!,
      {
        name: 'must-not-register.png',
        relative_path: 'projects/source-changed/output.png',
        content_hash: `sha256:${'f'.repeat(64)}`,
      },
    ), 'CHARACTER_IMAGE_SOURCE_INVALID');
    expect(store.characterImageJobs.get(running.id)).toMatchObject({
      status: 'running', output_asset_id: null, output_reference_id: null,
    });
  });

  it('recovers expired active jobs once and preserves submit intent', () => {
    const { databasePath, store: first } = fileStore();
    const { projectId, characterId } = seedCharacter(first);
    const draft = first.characterImageJobs.create(projectId, characterId,
      imageJobInput('recover-image-job'));
    const claimed = first.characterImageJobs.claim(draft.id, 120_000);
    first.characterImageJobs.markSubmitIntent(
      draft.id,
      claimed.lease_token!,
      'recover-client-id',
    );
    first.close();
    stores.splice(stores.indexOf(first), 1);
    const raw = new Database(databasePath);
    raw.prepare('UPDATE character_image_jobs SET lease_expires_at = ? WHERE id = ?')
      .run('2000-01-01T00:00:00.000Z', draft.id);
    raw.close();

    const reopened = track(new ProjectStore(databasePath));
    expect(reopened.characterImageJobs.get(draft.id)).toMatchObject({
      status: 'timed_out',
      provider_client_id: 'recover-client-id',
    });
    expect(reopened.characterImageJobs.recoverExpired()).toBe(0);
    const reclaimed = reopened.characterImageJobs.claim(draft.id, 120_000);
    expect(reclaimed.attempt).toBe(2);
    expect(reclaimed.lease_token).not.toBe(claimed.lease_token);
    expect(reclaimed.provider_client_id).toBe('recover-client-id');
    expect(reopened.characterImageJobs.listEvents(draft.id)
      .filter(({ to_status }) => to_status === 'timed_out')).toHaveLength(1);
    expectStoreCode(() => reopened.characterImageJobs.markQueued(
      draft.id,
      claimed.lease_token!,
      'stale-recovery-provider',
    ), 'CHARACTER_IMAGE_JOB_LEASE_INVALID');
  });

  it('retries failed work as a new immutable job', () => {
    const store = track(new ProjectStore(':memory:'));
    const { projectId, characterId } = seedCharacter(store);
    const draft = store.characterImageJobs.create(projectId, characterId,
      imageJobInput('failed-image-retry'));
    const first = store.characterImageJobs.claim(draft.id, 120_000);
    expect(store.characterImageJobs.fail(
      draft.id,
      first.lease_token!,
      'IMAGE_COMFY_HTTP',
      'ComfyUI returned an unavailable response.',
    ).status).toBe('failed');
    const retry = store.characterImageJobs.retry(projectId, draft.id, {
      idempotency_key: 'failed-image-retry-002',
    });
    expect(retry).toMatchObject({
      retry_of_job_id: draft.id,
      status: 'draft',
      attempt: 0,
      prompt: draft.prompt,
      source_inputs: draft.source_inputs,
    });
    expect(store.characterImageJobs.retry(projectId, draft.id, {
      idempotency_key: 'failed-image-retry-002',
    }).id).toBe(retry.id);
    expectStoreCode(() => store.characterImageJobs.retry(projectId, draft.id, {
      idempotency_key: 'failed-image-retry-duplicate',
    }), 'CHARACTER_IMAGE_RETRY_INVALID');
    expect(store.characterImageJobs.get(draft.id)).toMatchObject({
      status: 'failed',
      attempt: 1,
      retry_of_job_id: null,
      error_code: 'IMAGE_COMFY_HTTP',
    });
    expectStoreCode(() => store.characterImageJobs.claim(draft.id, 120_000),
      'CHARACTER_IMAGE_JOB_STATUS_INVALID');
    const second = store.characterImageJobs.claim(retry.id, 120_000);
    expect(second.attempt).toBe(1);
    expectStoreCode(() => store.characterImageJobs.markQueued(
      draft.id,
      first.lease_token!,
      'stale-provider-task',
    ), 'CHARACTER_IMAGE_JOB_STATUS_INVALID');
    expectStoreCode(() => store.characterImageJobs.markQueued(
      retry.id,
      second.lease_token!,
      'provider-without-intent',
    ), 'CHARACTER_IMAGE_SUBMIT_INTENT_REQUIRED');
    expect(store.characterImageJobs.cancel(
      retry.id,
      'Superseded by a new art direction.',
    )).toMatchObject({
      status: 'canceled',
      cancel_reason: 'Superseded by a new art direction.',
    });
    expect(store.characterImageJobs.listEvents(draft.id)
      .map(({ to_status }) => to_status))
      .toEqual(['draft', 'submitting', 'failed']);
    expect(store.characterImageJobs.listEvents(retry.id)
      .map(({ to_status }) => to_status))
      .toEqual(['draft', 'submitting', 'canceled']);
  });

  it('rejects failure codes outside the protocol enum before persistence', () => {
    const store = track(new ProjectStore(':memory:'));
    const { projectId, characterId } = seedCharacter(store);
    const draft = store.characterImageJobs.create(projectId, characterId,
      imageJobInput('invalid-failure-code'));
    const claimed = store.characterImageJobs.claim(draft.id, 120_000);
    const unsafe = store.characterImageJobs as unknown as {
      fail(jobId: string, leaseToken: string, errorCode: string,
        errorMessage: string): unknown;
      forceFail(jobId: string, leaseToken: string, errorCode: string,
        errorMessage: string): unknown;
    };

    expectStoreCode(() => unsafe.fail(draft.id, claimed.lease_token!,
      'SOME_UNDECLARED_ERROR', 'Invalid code must not reach SQLite.'),
    'INPUT_INVALID');
    expectStoreCode(() => unsafe.forceFail(draft.id, claimed.lease_token!,
      'SOME_UNDECLARED_ERROR', 'Invalid code must not reach SQLite.'),
    'INPUT_INVALID');
    expect(store.characterImageJobs.get(draft.id)).toMatchObject({
      status: 'submitting', error_code: null,
    });
  });

  it('prevents a production lock from crossing active image work', () => {
    const store = track(new ProjectStore(':memory:'));
    const { projectId, characterId } = seedCharacter(store);
    const draft = store.characterImageJobs.create(projectId, characterId,
      imageJobInput('lock-crossing-image-job'));
    store.characterImageJobs.claim(draft.id, 120_000);

    expectStoreCode(() => store.production.updateLock(projectId, {
      engaged: true,
      reason: 'Must wait for character image output.',
    }), 'LOCK_IMAGE_JOBS_ACTIVE');
    store.characterImageJobs.cancel(draft.id, 'Clear the active image task.');
    expect(store.production.updateLock(projectId, {
      engaged: true,
      reason: 'Image work is no longer active.',
    }).engaged).toBe(true);
    const blockedDraft = store.production.updateLock(projectId, {
      engaged: false,
    });
    expect(blockedDraft.engaged).toBe(false);
    const waiting = store.characterImageJobs.create(projectId, characterId,
      imageJobInput('draft-before-lock'));
    store.production.updateLock(projectId, {
      engaged: true,
      reason: 'Draft image task must not start under a frozen manifest.',
    });
    expectStoreCode(() => store.characterImageJobs.claim(waiting.id),
      'LOCK_ENGAGED');
  });
});

describe('shared GPU host leases', () => {
  it('mutually excludes H3 and image owners across database connections', () => {
    const { databasePath, store: first } = fileStore();
    const { projectId, characterId } = seedCharacter(first);
    const imageDraft = first.characterImageJobs.create(projectId, characterId,
      imageJobInput('gpu-owner-image'));
    const imageJob = first.characterImageJobs.claim(imageDraft.id, 120_000);
    const h3Project = seedCharacter(first, 'H3 owner');
    const h3Job = seedClaimedH3(first, h3Project.projectId);
    const second = track(new ProjectStore(databasePath));

    const lease = first.gpuLeases.acquire(
      '4090-main',
      'character_image',
      imageJob.id,
      120_000,
    );
    expectStoreCode(() => second.gpuLeases.acquire(
      '4090-main',
      'h3_video',
      h3Job.id,
      120_000,
    ), 'GPU_LEASE_BUSY');
    expectStoreCode(() => second.gpuLeases.release(
      '4090-main',
      crypto.randomUUID(),
    ), 'GPU_LEASE_INVALID');
    const renewed = first.gpuLeases.heartbeat(
      '4090-main',
      lease.lease_token,
      180_000,
    );
    expect(Date.parse(renewed.lease_expires_at))
      .toBeGreaterThan(Date.parse(lease.lease_expires_at));
    expect(first.gpuLeases.release('4090-main', lease.lease_token))
      .toEqual(renewed);
    expect(second.gpuLeases.acquire(
      '4090-main',
      'h3_video',
      h3Job.id,
      120_000,
    ).owner_job_id).toBe(h3Job.id);
  });

  it('recovers an expired owner and permits exactly one replacement', () => {
    const { databasePath, store: first } = fileStore();
    const { projectId, characterId } = seedCharacter(first);
    const firstJob = first.characterImageJobs.claim(
      first.characterImageJobs.create(projectId, characterId,
        imageJobInput('expired-gpu-owner')).id,
      120_000,
    );
    const secondJob = first.characterImageJobs.claim(
      first.characterImageJobs.create(projectId, characterId,
        imageJobInput('replacement-gpu-owner')).id,
      120_000,
    );
    first.gpuLeases.acquire(
      '4090-main',
      'character_image',
      firstJob.id,
      120_000,
    );
    const raw = new Database(databasePath);
    raw.prepare('UPDATE gpu_leases SET lease_expires_at = ? WHERE gpu_host = ?')
      .run('2000-01-01T00:00:00.000Z', '4090-main');
    raw.close();

    const second = track(new ProjectStore(databasePath));
    expect(second.gpuLeases.recoverExpired()).toBe(0);
    const replacement = second.gpuLeases.acquire(
      '4090-main',
      'character_image',
      secondJob.id,
      120_000,
    );
    expect(replacement.owner_job_id).toBe(secondJob.id);
    expectStoreCode(() => first.gpuLeases.acquire(
      '4090-main',
      'character_image',
      firstJob.id,
      120_000,
    ), 'GPU_LEASE_BUSY');
  });
});

describe('schema migrations v20-v25', () => {
  it('records image jobs, GPU leases, and single-retry enforcement', () => {
    const { databasePath, store } = fileStore();
    store.close();
    stores.splice(stores.indexOf(store), 1);
    const database = new Database(databasePath, { readonly: true });
    const version = database.prepare(
      'SELECT MAX(version) AS version FROM schema_version',
    ).get() as { version: number };
    const tables = new Set((database.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'`,
    ).all() as Array<{ name: string }>).map(({ name }) => name));
    const assetColumns = new Set((database.pragma('table_info(assets)') as
      Array<{ name: string }>).map(({ name }) => name));
    const jobColumns = new Set((database.pragma(
      'table_info(character_image_jobs)',
    ) as Array<{ name: string }>).map(({ name }) => name));
    const indexes = new Set((database.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index'`,
    ).all() as Array<{ name: string }>).map(({ name }) => name));
    database.close();

    expect(version.version).toBe(28);
    expect(tables.has('character_image_jobs')).toBe(true);
    expect(tables.has('character_image_job_events')).toBe(true);
    expect(tables.has('gpu_leases')).toBe(true);
    expect(assetColumns.has('producer_image_job_id')).toBe(true);
    expect(jobColumns.has('retry_of_job_id')).toBe(true);
    expect(indexes.has('idx_character_image_jobs_single_retry')).toBe(true);
  });

  it('upgrades a provisional v20 image-job table missing retry lineage', () => {
    const { databasePath, store } = fileStore();
    store.close();
    stores.splice(stores.indexOf(store), 1);
    const provisional = new Database(databasePath);
    provisional.exec(`
      DROP INDEX IF EXISTS idx_character_image_jobs_single_retry;
      DROP INDEX IF EXISTS idx_character_image_jobs_retry;
      ALTER TABLE character_image_jobs DROP COLUMN retry_of_job_id;
      DELETE FROM schema_version WHERE version = 21;
    `);
    provisional.close();

    const upgraded = track(new ProjectStore(databasePath));
    upgraded.close();
    stores.splice(stores.indexOf(upgraded), 1);
    const inspected = new Database(databasePath, { readonly: true });
    const columns = new Set((inspected.pragma(
      'table_info(character_image_jobs)') as Array<{ name: string }>)
      .map(({ name }) => name));
    const indexes = new Set((inspected.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index'`).all() as
      Array<{ name: string }>).map(({ name }) => name));
    inspected.close();
    expect(columns.has('retry_of_job_id')).toBe(true);
    expect(indexes.has('idx_character_image_jobs_retry')).toBe(true);
    expect(indexes.has('idx_character_image_jobs_single_retry')).toBe(true);
  });
});

function seedCharacter(store: ProjectStore, title = 'Character job') {
  const project = store.createProject({
    title,
    script_title: `${title} script`,
    script_content: 'A complete script establishes a durable image job test.',
  });
  const character = store.characters.create(project.id, {
    name: `${title} courier`,
    canonical_appearance: 'A courier with stable features and a dark raincoat.',
    seed_family: [2026082401],
  });
  return { projectId: project.id, characterId: character.id };
}

function seedApprovedRoot(store: ProjectStore, title = 'Root') {
  const seeded = seedCharacter(store, title);
  const root = store.characterMedia.registerUpload(
    seeded.projectId,
    seeded.characterId,
    uploadInput(`${title}-root`, null),
  );
  store.characterMedia.approveReference(
    seeded.projectId,
    seeded.characterId,
    root.reference.id,
    { make_primary: true },
  );
  return { ...seeded, root: {
    ...root,
    asset: store.getAsset(root.asset.id),
  } };
}

function uploadInput(key: string, derivedFrom: string | null) {
  return {
    idempotency_key: key,
    request_hash: `sha256:${key}`,
    name: `${key}.png`,
    relative_path: `characters/${key}.png`,
    content_hash: `sha256:${'d'.repeat(64)}`,
    derived_from: derivedFrom,
  };
}

function imageJobInput(key: string, overrides: Record<string, unknown> = {}) {
  return {
    operation: 'master_t2i' as const,
    provider: 'local_comfyui' as const,
    engine: 'krea2' as const,
    prompt: 'Cinematic portrait with a stable face and wardrobe.',
    seed: 2026082401,
    width: 480,
    height: 864,
    steps: 8,
    cfg: 1,
    sampler: 'euler_ancestral',
    scheduler: 'sgm_uniform',
    denoise: null,
    lora_profile: null,
    lora_name: null,
    lora_strength: null,
    source_reference_ids: [],
    idempotency_key: key,
    ...overrides,
  };
}

function runToRunning(store: ProjectStore, projectId: string,
  characterId: string, key: string, sourceReferenceId: string) {
  const draft = store.characterImageJobs.create(projectId, characterId,
    imageJobInput(key, {
      operation: 'variant_i2i', engine: 'krea2', denoise: 0.42,
      source_reference_ids: [sourceReferenceId],
    }));
  const claimed = store.characterImageJobs.claim(draft.id, 120_000);
  store.characterImageJobs.markSubmitIntent(
    draft.id,
    claimed.lease_token!,
    `client-${key}`,
  );
  store.characterImageJobs.markQueued(
    draft.id,
    claimed.lease_token!,
    `provider-${key}`,
  );
  return store.characterImageJobs.markRunning(draft.id, claimed.lease_token!);
}

function seedClaimedH3(store: ProjectStore, projectId: string) {
  store.modes.create({
    key: 'gpu-lease-mode',
    title: 'GPU lease mode',
    description: 'A production mode used to test shared GPU exclusion.',
    capability_declaration: {
      generation_modes: ['t2v'],
      duration_seconds: { min: 4, max: 15 },
      resolution: { min_width: 480, max_width: 480,
        min_height: 864, max_height: 864 },
      lora_profile_requirements: [],
      provider_requirements: ['local_comfyui'],
      extensions: {},
    },
  });
  const context = store.createAsset(projectId, {
    kind: 'image',
    uri: `context/${projectId}.png`,
    content_hash: null,
  });
  store.updateAsset(projectId, { asset_id: context.id, status: 'approved' });
  store.freezeCurrentAssetsManifest(projectId);
  store.production.createBrief(projectId, {
    mode_key: 'gpu-lease-mode',
    body: { logline: 'Shared GPU exclusion', style_notes: 'Stable test.',
      text_style_lock: null, hard_rules: ['One owner per GPU host.'] },
  });
  const shot = store.createShotPlan(projectId, {
    title: 'GPU lease shot', scene_id: 'GPU-01', duration_seconds: 6,
    shot_size: 'medium', camera_movement: 'locked',
    action: 'The worker waits for exclusive GPU ownership.',
    dialogue: '', sound: '', prompt: 'Stable GPU lease shot.',
    continuity_mode: 'independent', continuity_dependencies: [],
    costume_state: {}, reference_bindings: [],
  });
  store.production.updateLock(projectId, {
    engaged: true,
    reason: 'GPU lease integration test',
  });
  const job = store.createH3Job(shot.id, {
    mode: 't2v', provider: 'local_comfyui', model: 'H3-local',
    prompt: 'Stable GPU lease shot.', duration_seconds: 6,
    seed: 1, steps: 20, idempotency_key: 'gpu-lease-h3-owner',
    input_bindings: [],
  });
  return store.claimH3Job(job.id, 120_000);
}

function fileStore(): { databasePath: string; store: ProjectStore } {
  const directory = mkdtempSync(join(tmpdir(), 'h3-character-image-job-'));
  directories.push(directory);
  const databasePath = join(directory, 'project.db');
  return { databasePath, store: track(new ProjectStore(databasePath)) };
}

function track(store: ProjectStore): ProjectStore {
  stores.push(store);
  return store;
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
