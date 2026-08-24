import {
  FinalizeCharacterImageOutputInputSchema,
  type CharacterImageOutputResult,
  type FinalizeCharacterImageOutputInput,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { StoreError } from './errors.js';
import { parseInput } from './input.js';
import {
  mapAsset,
  mapCharacterImageJob,
  mapCharacterReference,
} from './row-mappers.js';
import { runWriteTransaction } from './transactions.js';
import {
  appendCharacterImageJobEvent,
  getCharacterImageJob,
  requireCharacterImageLeaseToken,
  requireCharacterImageTransition,
} from './character-image-job-support.js';

export function finalizeCharacterImageOutput(
  db: Database.Database,
  jobId: string,
  leaseToken: string,
  rawInput: FinalizeCharacterImageOutputInput,
): CharacterImageOutputResult {
  const input = parseInput(
    FinalizeCharacterImageOutputInputSchema,
    rawInput,
    'CHARACTER_IMAGE_OUTPUT_INVALID',
  );
  return runWriteTransaction(db, () => {
    const job = getCharacterImageJob(db, jobId);
    requireCharacterImageTransition(job, 'completed');
    requireCharacterImageLeaseToken(job, leaseToken);
    requireFrozenSourcesStillApproved(db, job);
    const assetId = randomUUID();
    const referenceId = randomUUID();
    const now = new Date().toISOString();
    const source = job.source_inputs[0] ?? null;
    const lineageSource = source === null ? null : resolveCanonicalSource(
      db, source.reference_id);
    const sortOrder = (db.prepare(`SELECT
      COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order
      FROM character_references WHERE character_id = ?`)
      .get(job.character_id) as { next_sort_order: number }).next_sort_order;
    db.prepare(`INSERT INTO assets
      (id, project_id, kind, name, relative_path, uri, content_hash, status,
       replaces_asset_id, derived_from_asset_id, derivation_kind,
       producer_image_job_id, created_at, updated_at)
      VALUES (?, ?, 'image', ?, ?, ?, ?, 'candidate', NULL, NULL, NULL,
              ?, ?, ?)`)
      .run(assetId, job.project_id, input.name, input.relative_path,
        input.relative_path, input.content_hash, jobId, now, now);
    db.prepare(`INSERT INTO character_references
      (id, character_id, asset_id, uri, kind, content_hash, derived_from,
       sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'image', ?, ?, ?, ?, ?)`)
      .run(referenceId, job.character_id, assetId, input.relative_path,
        input.content_hash, lineageSource?.reference_id ?? null,
        sortOrder, now, now);
    if (lineageSource) db.prepare(`INSERT INTO character_asset_derivations
      (asset_id, source_asset_id, kind, created_at) VALUES (?, ?, ?, ?)`)
      .run(assetId, lineageSource.asset_id, job.operation, now);
    const result = db.prepare(`UPDATE character_image_jobs
      SET status = 'completed', output_asset_id = ?, output_reference_id = ?,
          completed_at = ?, updated_at = ?, lease_token = NULL,
          lease_expires_at = NULL, heartbeat_at = ?
      WHERE id = ? AND status = 'running' AND lease_token = ?`)
      .run(assetId, referenceId, now, now, now, jobId, leaseToken);
    if (result.changes !== 1) throw new StoreError(
      'CHARACTER_IMAGE_JOB_STATUS_INVALID',
      'Character image job changed before completion could be recorded',
      { job_id: jobId },
    );
    appendCharacterImageJobEvent(
      db,
      jobId,
      'running',
      'completed',
      'Character image job completed with a candidate reference',
      now,
    );
    const derivation = source ? db.prepare(
      'SELECT * FROM character_asset_derivations WHERE asset_id = ?',
    ).get(assetId) : null;
    return {
      job: mapCharacterImageJob(db.prepare(
        'SELECT * FROM character_image_jobs WHERE id = ?',
      ).get(jobId)),
      asset: mapAsset(db.prepare('SELECT * FROM assets WHERE id = ?')
        .get(assetId)),
      reference: mapCharacterReference(db.prepare(
        'SELECT * FROM character_references WHERE id = ?',
      ).get(referenceId)),
      asset_derivation: derivation as CharacterImageOutputResult[
        'asset_derivation'
      ],
    };
  });
}

function resolveCanonicalSource(db: Database.Database,
  referenceId: string): { reference_id: string; asset_id: string } {
  const visited = new Set<string>();
  let currentId = referenceId;
  while (!visited.has(currentId)) {
    visited.add(currentId);
    const row = db.prepare(`SELECT id, asset_id, derived_from
      FROM character_references WHERE id = ?`).get(currentId) as {
        id: string; asset_id: string | null; derived_from: string | null;
      } | undefined;
    if (!row || row.asset_id === null) break;
    if (row.derived_from === null) return {
      reference_id: row.id, asset_id: row.asset_id,
    };
    currentId = row.derived_from;
  }
  throw new StoreError(
    'CHARACTER_IMAGE_SOURCE_INVALID',
    'Character image source lineage does not resolve to a root reference',
    { reference_id: referenceId },
  );
}

function requireFrozenSourcesStillApproved(db: Database.Database,
  job: ReturnType<typeof getCharacterImageJob>): void {
  for (const [ordinal, source] of job.source_inputs.entries()) {
    const row = db.prepare(`SELECT r.character_id, r.asset_id, r.derived_from,
      a.project_id, a.kind, a.status, a.content_hash
      FROM character_references r
      JOIN assets a ON a.id = r.asset_id
      WHERE r.id = ?`).get(source.reference_id) as {
        character_id: string; asset_id: string; derived_from: string | null;
        project_id: string; kind: string; status: string; content_hash: string;
      } | undefined;
    const valid = row && row.character_id === job.character_id &&
      row.project_id === job.project_id && row.asset_id === source.asset_id &&
      row.kind === 'image' && row.status === 'approved' &&
      row.content_hash === source.content_hash &&
      (job.operation !== 'variant_i2i' || ordinal !== 0 ||
        row.derived_from === null);
    if (!valid) throw new StoreError(
      'CHARACTER_IMAGE_SOURCE_INVALID',
      'A frozen character image source changed before completion',
      { job_id: job.id, reference_id: source.reference_id },
    );
  }
}
