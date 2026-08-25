import {
  H3_MAX_AUTO_ATTEMPTS,
  H3JobBatchSchema,
  type H3Job,
  type H3JobBatch,
  type H3JobBatchList,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { StoreError } from './errors.js';
import { mapH3Job } from './row-mappers.js';
import { requireProject } from './store-guards.js';

interface BatchRow {
  id: string;
  project_id: string;
  request_fingerprint: string;
  claimed_count: number;
  created_at: string;
  updated_at: string;
}

interface BatchItemRow {
  batch_id: string;
  batch_shot_plan_id: string;
  batch_ordinal: number;
  original_job_id: string;
}

export function h3BatchFingerprint(projectId: string, input: unknown): string {
  return createHash('sha256').update(JSON.stringify({ projectId, input }))
    .digest('hex');
}

export function findH3BatchIdByFingerprint(db: Database.Database,
  projectId: string, fingerprint: string): string | null {
  return (db.prepare(`SELECT id FROM h3_job_batches
    WHERE project_id = ? AND request_fingerprint = ?`)
    .get(projectId, fingerprint) as { id: string } | undefined)?.id ?? null;
}

export function createH3BatchRecord(db: Database.Database, projectId: string,
  fingerprint: string, jobs: Array<{ shot_plan_id: string; job: H3Job }>,
): H3JobBatch {
  const previousId = findH3BatchIdByFingerprint(db, projectId, fingerprint);
  if (previousId) return getH3JobBatch(db, projectId, previousId);
  const existingMembership = jobs.map(({ job }) =>
    findH3JobBatchByLineage(db, job.id) ?? undefined).find(Boolean);
  if (existingMembership) throw new StoreError(
    'H3_BATCH_CONFLICT',
    'One or more jobs already belong to a different immutable batch',
    { batch_id: existingMembership.batch_id },
  );
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO h3_job_batches
    (id, project_id, request_fingerprint, claimed_count, created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, ?)`).run(id, projectId, fingerprint, now, now);
  const insertItem = db.prepare(`INSERT INTO h3_job_batch_items
    (batch_id, shot_plan_id, ordinal, original_job_id, current_job_id)
    VALUES (?, ?, ?, ?, ?)`);
  jobs.forEach(({ shot_plan_id, job }, ordinal) => insertItem.run(
    id, shot_plan_id, ordinal, job.id, job.id));
  return getH3JobBatch(db, projectId, id);
}

export function listH3JobBatches(db: Database.Database,
  projectId: string): H3JobBatchList {
  requireProject(db, projectId);
  const rows = db.prepare(`SELECT * FROM h3_job_batches b
    WHERE b.project_id = ? AND (
      EXISTS (
        SELECT 1 FROM h3_job_batch_items bi
        JOIN h3_jobs j ON j.id = bi.current_job_id
        WHERE bi.batch_id = b.id AND j.status <> 'completed'
      ) OR b.id IN (
        SELECT recent.id FROM h3_job_batches recent
        WHERE recent.project_id = ? AND NOT EXISTS (
          SELECT 1 FROM h3_job_batch_items rbi
          JOIN h3_jobs rj ON rj.id = rbi.current_job_id
          WHERE rbi.batch_id = recent.id AND rj.status <> 'completed'
        ) ORDER BY recent.created_at DESC, recent.id DESC LIMIT 3
      )
    ) ORDER BY b.created_at DESC, b.id DESC`)
    .all(projectId, projectId) as BatchRow[];
  const batchIds = rows.map(({ id }) => id);
  const retryParents = loadRetryParents(db, batchIds);
  const itemRows = loadBatchItems(db, batchIds);
  return { project_id: projectId,
    batches: rows.map((batch) => mapH3JobBatch(
      batch, itemRows.get(batch.id) ?? [], retryParents)) };
}

export function getH3JobBatch(db: Database.Database, projectId: string,
  batchId: string): H3JobBatch {
  requireProject(db, projectId);
  const batch = db.prepare(`SELECT * FROM h3_job_batches
    WHERE id = ? AND project_id = ?`).get(batchId, projectId) as
    BatchRow | undefined;
  if (!batch) throw new StoreError('H3_BATCH_NOT_FOUND',
    'H3 job batch does not exist', { project_id: projectId,
      batch_id: batchId });
  return mapH3JobBatch(batch, loadBatchItems(db, [batch.id]).get(batch.id) ?? [],
    loadRetryParents(db, [batch.id]));
}

function mapH3JobBatch(batch: BatchRow, itemRows: BatchItemRow[],
  retryParents: ReadonlyMap<string, string | null>): H3JobBatch {
  const items = itemRows.map((item) => {
    const current = mapH3Job(item);
    return { shot_plan_id: item.batch_shot_plan_id, ordinal: item.batch_ordinal,
      original_job_id: item.original_job_id, current_job: current,
      retry_count: retryDepth(retryParents, item.original_job_id, current),
      retryable: ['failed', 'canceled', 'timed_out'].includes(current.status) };
  });
  const counts = { pending: 0, active: 0, recovering: 0,
    completed: 0, attention: 0 };
  for (const { current_job: job } of items) {
    counts[classify(job)] += 1;
  }
  const total = items.length;
  const status = counts.attention > 0 ? 'attention' :
    counts.completed === total ? 'completed' :
      counts.pending === total ? 'pending' : 'running';
  const updatedAt = items.reduce((latest, { current_job }) =>
    current_job.updated_at > latest ? current_job.updated_at : latest,
  batch.updated_at);
  return H3JobBatchSchema.parse({ id: batch.id, project_id: batch.project_id,
    status, progress: { total, ...counts,
      progress_percent: Math.floor((counts.completed / total) * 100) },
    items, created_at: batch.created_at, updated_at: updatedAt });
}

function loadBatchItems(db: Database.Database, batchIds: string[]) {
  const grouped = new Map<string, BatchItemRow[]>();
  if (batchIds.length === 0) return grouped;
  const placeholders = batchIds.map(() => '?').join(', ');
  const rows = db.prepare(`SELECT bi.batch_id,
      bi.shot_plan_id AS batch_shot_plan_id,
      bi.ordinal AS batch_ordinal, bi.original_job_id, j.*
    FROM h3_job_batch_items bi JOIN h3_jobs j ON j.id = bi.current_job_id
    WHERE bi.batch_id IN (${placeholders})
    ORDER BY bi.batch_id, bi.ordinal`).all(...batchIds) as BatchItemRow[];
  for (const row of rows) {
    const items = grouped.get(row.batch_id) ?? [];
    items.push(row);
    grouped.set(row.batch_id, items);
  }
  return grouped;
}

export function findH3JobBatchByCurrentJob(db: Database.Database,
  jobId: string): { batch_id: string } | null {
  return (db.prepare(`SELECT batch_id FROM h3_job_batch_items
    WHERE current_job_id = ?`).get(jobId) as { batch_id: string } | undefined)
    ?? null;
}

export function findH3JobBatchByLineage(db: Database.Database,
  jobId: string): { batch_id: string } | null {
  return (db.prepare(`WITH RECURSIVE lineage(id, retry_of_job_id) AS (
      SELECT id, retry_of_job_id FROM h3_jobs WHERE id = ?
      UNION ALL
      SELECT h.id, h.retry_of_job_id FROM h3_jobs h
      JOIN lineage l ON h.id = l.retry_of_job_id
    ) SELECT bi.batch_id FROM h3_job_batch_items bi
      JOIN lineage l ON bi.original_job_id = l.id OR bi.current_job_id = l.id
      LIMIT 1`).get(jobId) as { batch_id: string } | undefined) ?? null;
}

function classify(job: H3Job): keyof Omit<
  H3JobBatch['progress'], 'total' | 'progress_percent'> {
  if (job.status === 'draft') return 'pending';
  if (['submitting', 'queued', 'running'].includes(job.status)) return 'active';
  if (job.status === 'completed') return 'completed';
  if (job.status === 'timed_out' && job.attempt < H3_MAX_AUTO_ATTEMPTS) {
    return 'recovering';
  }
  return 'attention';
}

function loadRetryParents(db: Database.Database, batchIds: string[]) {
  if (batchIds.length === 0) return new Map<string, string | null>();
  const placeholders = batchIds.map(() => '?').join(', ');
  const rows = db.prepare(`WITH RECURSIVE lineage(id, retry_of_job_id) AS (
      SELECT j.id, j.retry_of_job_id FROM h3_job_batch_items bi
      JOIN h3_jobs j ON j.id = bi.current_job_id
      WHERE bi.batch_id IN (${placeholders})
      UNION ALL
      SELECT h.id, h.retry_of_job_id FROM h3_jobs h
      JOIN lineage l ON h.id = l.retry_of_job_id
    ) SELECT DISTINCT id, retry_of_job_id FROM lineage`).all(...batchIds) as
    Array<{
      id: string; retry_of_job_id: string | null;
    }>;
  return new Map(rows.map(({ id, retry_of_job_id }) =>
    [id, retry_of_job_id] as const));
}

function retryDepth(parents: ReadonlyMap<string, string | null>,
  originalId: string,
  current: H3Job): number {
  let depth = 0;
  let cursorId = current.id;
  const visited = new Set<string>();
  while (cursorId !== originalId) {
    const parentId = parents.get(cursorId);
    if (!parentId || visited.has(cursorId)) throw new StoreError(
      'DATABASE_RECORD_INVALID', 'H3 retry lineage is not connected to batch',
      { original_job_id: originalId, current_job_id: current.id });
    visited.add(cursorId);
    cursorId = parentId;
    depth += 1;
  }
  return depth;
}
