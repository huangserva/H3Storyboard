import type {
  CharacterImageJob,
  CharacterImageSourceInput,
  ParsedCharacterImageJobInput,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { StoreError } from './errors.js';

export function resolveCharacterImageSourceInputs(
  db: Database.Database,
  projectId: string,
  characterId: string,
  input: ParsedCharacterImageJobInput,
): CharacterImageSourceInput[] {
  return input.source_reference_ids.map((referenceId, index) => {
    const row = db.prepare(`SELECT r.id AS reference_id, r.character_id,
      r.asset_id, r.derived_from, c.project_id, a.kind AS asset_kind,
      a.status AS asset_status, a.content_hash
      FROM character_references r
      JOIN characters c ON c.id = r.character_id
      LEFT JOIN assets a ON a.id = r.asset_id
      WHERE r.id = ?`).get(referenceId) as SourceRow | undefined;
    const valid = row && row.project_id === projectId &&
      row.character_id === characterId && row.asset_id !== null &&
      row.asset_kind === 'image' && row.asset_status === 'approved' &&
      typeof row.content_hash === 'string' &&
      /^sha256:[a-f0-9]{64}$/.test(row.content_hash);
    const requiresRoot = input.operation === 'variant_i2i' && index === 0;
    if (!valid || (requiresRoot && row.derived_from !== null)) {
      throw new StoreError(
        'CHARACTER_IMAGE_SOURCE_INVALID',
        'Image jobs require approved image-backed sources from the same character; Krea variants require a root mother image',
        { project_id: projectId, character_id: characterId,
          reference_id: referenceId },
      );
    }
    return {
      reference_id: row.reference_id,
      asset_id: row.asset_id!,
      content_hash: row.content_hash!,
    };
  });
}

export function characterImageInputFingerprint(
  input: ParsedCharacterImageJobInput,
): string {
  return JSON.stringify(input);
}

export function persistedCharacterImageJobFingerprint(
  job: CharacterImageJob,
): string {
  return JSON.stringify({
    operation: job.operation,
    provider: job.provider,
    engine: job.engine,
    prompt: job.prompt,
    seed: job.seed,
    width: job.width,
    height: job.height,
    steps: job.steps,
    cfg: job.cfg,
    sampler: job.sampler,
    scheduler: job.scheduler,
    denoise: job.denoise,
    lora_profile: job.lora_profile,
    lora_name: job.lora_name,
    lora_strength: job.lora_strength,
    source_reference_ids: job.source_inputs.map(({ reference_id }) =>
      reference_id),
    idempotency_key: job.idempotency_key,
  });
}

interface SourceRow {
  reference_id: string;
  character_id: string;
  asset_id: string | null;
  derived_from: string | null;
  project_id: string;
  asset_kind: string | null;
  asset_status: string | null;
  content_hash: string | null;
}
