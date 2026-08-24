import {
  CreateCharacterImageJobInputSchema,
  RetryCharacterImageJobInputSchema,
  type CharacterImageJob,
  type CreateCharacterImageJobInput,
  type RetryCharacterImageJobInput,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { StoreError } from './errors.js';
import { requireGenerationUnlocked } from './generation-locks.js';
import { parseInput } from './input.js';
import { runWriteTransaction } from './transactions.js';
import {
  appendCharacterImageJobEvent,
  getCharacterImageJob,
} from './character-image-job-support.js';
import {
  characterImageInputFingerprint,
  persistedCharacterImageJobFingerprint,
  resolveCharacterImageSourceInputs,
} from './character-image-job-input.js';

export function createCharacterImageJob(
  db: Database.Database,
  projectId: string,
  characterId: string,
  rawInput: CreateCharacterImageJobInput,
): CharacterImageJob {
  const input = parseInput(
    CreateCharacterImageJobInputSchema,
    rawInput,
    'CHARACTER_IMAGE_INPUT_INVALID',
  );
  return runWriteTransaction(db, () => {
    const character = db.prepare(
      'SELECT project_id, status FROM characters WHERE id = ?',
    ).get(characterId) as { project_id: string; status: string } | undefined;
    if (!character || character.project_id !== projectId) throw new StoreError(
      'CHARACTER_NOT_FOUND',
      'Character does not exist',
      { project_id: projectId, character_id: characterId },
    );
    const previous = db.prepare(`SELECT * FROM character_image_jobs
      WHERE character_id = ? AND idempotency_key = ?`)
      .get(characterId, input.idempotency_key);
    if (previous) {
      const existing = getCharacterImageJob(
        db,
        (previous as { id: string }).id,
      );
      if (persistedCharacterImageJobFingerprint(existing) !==
        characterImageInputFingerprint(input)) {
        throw new StoreError(
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency key was already used with different character image input',
          { character_id: characterId,
            idempotency_key: input.idempotency_key },
        );
      }
      return existing;
    }
    if (character.status === 'archived') throw new StoreError(
      'CHARACTER_ARCHIVED',
      'Archived character is immutable',
      { character_id: characterId },
    );
    requireGenerationUnlocked(db, projectId);
    const sources = resolveCharacterImageSourceInputs(
      db,
      projectId,
      characterId,
      input,
    );
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO character_image_jobs
      (id, project_id, character_id, retry_of_job_id, operation, provider,
       engine, prompt, seed,
       width, height, steps, cfg, sampler, scheduler, denoise, lora_profile,
       lora_name, lora_strength, source_inputs_json, idempotency_key, status,
       attempt, provider_client_id, provider_job_id, output_asset_id,
       output_reference_id, error_code, error_message, cancel_reason,
       lease_token, lease_expires_at, heartbeat_at, created_at, updated_at,
       completed_at)
      VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              'draft', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
              NULL, ?, ?, NULL)`)
      .run(id, projectId, characterId, input.operation, input.provider,
        input.engine, input.prompt, input.seed, input.width, input.height,
        input.steps, input.cfg, input.sampler, input.scheduler, input.denoise,
        input.lora_profile, input.lora_name, input.lora_strength,
        JSON.stringify(sources), input.idempotency_key, now, now);
    appendCharacterImageJobEvent(
      db,
      id,
      null,
      'draft',
      'Character image job created',
      now,
    );
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
      .run(now, projectId);
    return getCharacterImageJob(db, id);
  });
}

export function retryCharacterImageJob(
  db: Database.Database,
  projectId: string,
  jobId: string,
  rawInput: RetryCharacterImageJobInput,
): CharacterImageJob {
  const input = parseInput(
    RetryCharacterImageJobInputSchema,
    rawInput,
    'CHARACTER_IMAGE_INPUT_INVALID',
  );
  return runWriteTransaction(db, () => {
    const original = getCharacterImageJob(db, jobId);
    if (original.project_id !== projectId) throw new StoreError(
      'CHARACTER_IMAGE_JOB_NOT_FOUND',
      'Character image job does not exist',
      { project_id: projectId, job_id: jobId },
    );
    const previous = db.prepare(`SELECT id FROM character_image_jobs
      WHERE character_id = ? AND idempotency_key = ?`)
      .get(original.character_id, input.idempotency_key) as
      { id: string } | undefined;
    if (previous) {
      const existing = getCharacterImageJob(db, previous.id);
      if (existing.retry_of_job_id !== original.id ||
        persistedCharacterImageJobFingerprint(existing) !==
          retryFingerprint(original, input.idempotency_key)) {
        throw new StoreError(
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency key was already used for another character image job',
          { character_id: original.character_id,
            idempotency_key: input.idempotency_key },
        );
      }
      return existing;
    }
    const existingRetry = db.prepare(`SELECT id FROM character_image_jobs
      WHERE retry_of_job_id = ? LIMIT 1`).get(original.id) as
      { id: string } | undefined;
    if (existingRetry) throw new StoreError(
      'CHARACTER_IMAGE_RETRY_INVALID',
      'Character image job already has an immutable retry',
      { job_id: original.id, retry_job_id: existingRetry.id },
    );
    if (!['failed', 'canceled', 'timed_out'].includes(original.status)) {
      throw new StoreError(
        'CHARACTER_IMAGE_RETRY_INVALID',
        'Only failed, canceled, or timed-out image jobs can be retried',
        { job_id: jobId, status: original.status },
      );
    }
    requireGenerationUnlocked(db, projectId);
    const character = db.prepare(
      'SELECT status FROM characters WHERE id = ? AND project_id = ?',
    ).get(original.character_id, projectId) as { status: string } | undefined;
    if (!character) throw new StoreError(
      'CHARACTER_NOT_FOUND',
      'Character does not exist',
      { project_id: projectId, character_id: original.character_id },
    );
    if (character.status === 'archived') throw new StoreError(
      'CHARACTER_ARCHIVED',
      'Archived character is immutable',
      { character_id: original.character_id },
    );
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO character_image_jobs
      (id, project_id, character_id, retry_of_job_id, operation, provider,
       engine, prompt, seed, width, height, steps, cfg, sampler, scheduler,
       denoise, lora_profile, lora_name, lora_strength, source_inputs_json,
       idempotency_key, status, attempt, provider_client_id, provider_job_id,
       output_asset_id, output_reference_id, error_code, error_message,
       cancel_reason, lease_token, lease_expires_at, heartbeat_at, created_at,
       updated_at, completed_at)
      SELECT ?, project_id, character_id, ?, operation, provider, engine,
       prompt, seed, width, height, steps, cfg, sampler, scheduler, denoise,
       lora_profile, lora_name, lora_strength, source_inputs_json, ?, 'draft',
       0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL
      FROM character_image_jobs WHERE id = ?`)
      .run(id, original.id, input.idempotency_key, now, now, original.id);
    appendCharacterImageJobEvent(
      db,
      id,
      null,
      'draft',
      'Character image retry created from immutable input',
      now,
    );
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
      .run(now, projectId);
    return getCharacterImageJob(db, id);
  });
}

export function listCharacterImageJobs(
  db: Database.Database,
  projectId: string,
  characterId?: string,
): CharacterImageJob[] {
  if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)) {
    throw new StoreError('PROJECT_NOT_FOUND', 'Project does not exist', {
      project_id: projectId,
    });
  }
  if (characterId && !db.prepare(
    'SELECT 1 FROM characters WHERE id = ? AND project_id = ?',
  ).get(characterId, projectId)) throw new StoreError(
    'CHARACTER_NOT_FOUND',
    'Character does not exist',
    { project_id: projectId, character_id: characterId },
  );
  const rows = characterId
    ? db.prepare(`SELECT id FROM character_image_jobs
        WHERE project_id = ? AND character_id = ? ORDER BY created_at, id`)
      .all(projectId, characterId)
    : db.prepare(`SELECT id FROM character_image_jobs
        WHERE project_id = ? ORDER BY created_at, id`).all(projectId);
  return (rows as Array<{ id: string }>).map(
    ({ id }) => getCharacterImageJob(db, id),
  );
}

function retryFingerprint(
  original: CharacterImageJob,
  idempotencyKey: string,
): string {
  return JSON.stringify({
    operation: original.operation,
    provider: original.provider,
    engine: original.engine,
    prompt: original.prompt,
    seed: original.seed,
    width: original.width,
    height: original.height,
    steps: original.steps,
    cfg: original.cfg,
    sampler: original.sampler,
    scheduler: original.scheduler,
    denoise: original.denoise,
    lora_profile: original.lora_profile,
    lora_name: original.lora_name,
    lora_strength: original.lora_strength,
    source_reference_ids: original.source_inputs.map(({ reference_id }) =>
      reference_id),
    idempotency_key: idempotencyKey,
  });
}
