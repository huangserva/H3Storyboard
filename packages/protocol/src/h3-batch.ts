import { z } from 'zod';
import { IdSchema, NonEmptyTextSchema, TimestampSchema } from './common.js';
import { CreateH3JobInputSchema, H3JobSchema, H3_MAX_AUTO_ATTEMPTS } from
  './h3-job.js';

export const RetryH3JobInputSchema = z.object({
  idempotency_key: NonEmptyTextSchema.min(8).max(200),
});
export type RetryH3JobInput = z.input<typeof RetryH3JobInputSchema>;

export const CreateH3JobBatchItemSchema = z.object({
  shot_plan_id: IdSchema,
  job: CreateH3JobInputSchema,
});
export type CreateH3JobBatchItem = z.input<
  typeof CreateH3JobBatchItemSchema
>;

export const CreateH3JobBatchInputSchema = z.object({
  items: z.array(CreateH3JobBatchItemSchema).min(1).max(100),
}).superRefine((value, context) => {
  const seen = new Set<string>();
  value.items.forEach((item, index) => {
    if (seen.has(item.shot_plan_id)) context.addIssue({
      code: 'custom',
      message: 'shot_plan_id must be unique within a job batch',
      path: ['items', index, 'shot_plan_id'],
    });
    seen.add(item.shot_plan_id);
  });
});
export type CreateH3JobBatchInput = z.input<
  typeof CreateH3JobBatchInputSchema
>;

export const H3JobBatchStatusSchema = z.enum([
  'pending',
  'running',
  'attention',
  'completed',
]);
export type H3JobBatchStatus = z.infer<typeof H3JobBatchStatusSchema>;

export const H3JobBatchProgressSchema = z.object({
  total: z.number().int().positive(),
  pending: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  recovering: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  attention: z.number().int().nonnegative(),
  progress_percent: z.number().int().min(0).max(100),
});
export type H3JobBatchProgress = z.infer<typeof H3JobBatchProgressSchema>;

export const H3JobBatchItemSchema = z.object({
  shot_plan_id: IdSchema,
  ordinal: z.number().int().nonnegative(),
  original_job_id: IdSchema,
  current_job: H3JobSchema,
  retry_count: z.number().int().nonnegative(),
  retryable: z.boolean(),
});
export type H3JobBatchItem = z.infer<typeof H3JobBatchItemSchema>;

export const H3JobBatchSchema = z.object({
  id: IdSchema,
  project_id: IdSchema,
  status: H3JobBatchStatusSchema,
  progress: H3JobBatchProgressSchema,
  items: z.array(H3JobBatchItemSchema).min(1).max(100),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
}).superRefine((batch, context) => {
  const progress = batch.progress;
  const classified = progress.pending + progress.active +
    progress.recovering + progress.completed + progress.attention;
  if (progress.total !== batch.items.length || classified !== progress.total) {
    context.addIssue({ code: 'custom', message:
      'batch progress counts must classify every item exactly once',
      path: ['progress'] });
  }
  const derived = { pending: 0, active: 0, recovering: 0,
    completed: 0, attention: 0 };
  for (const { current_job: job } of batch.items) {
    if (job.status === 'draft') derived.pending += 1;
    else if (['submitting', 'queued', 'running'].includes(job.status)) {
      derived.active += 1;
    } else if (job.status === 'completed') derived.completed += 1;
    else if (job.status === 'timed_out' &&
      job.attempt < H3_MAX_AUTO_ATTEMPTS) derived.recovering += 1;
    else derived.attention += 1;
  }
  if (Object.entries(derived).some(([key, value]) =>
    progress[key as keyof typeof derived] !== value)) context.addIssue({
    code: 'custom', message: 'batch progress must derive from current jobs',
    path: ['progress'],
  });
  const expectedPercent = Math.floor(
    (progress.completed / progress.total) * 100);
  if (progress.progress_percent !== expectedPercent) context.addIssue({
    code: 'custom', message: 'progress_percent must derive from completed items',
    path: ['progress', 'progress_percent'],
  });
  const expectedStatus = progress.attention > 0 ? 'attention' :
    progress.completed === progress.total ? 'completed' :
      progress.pending === progress.total ? 'pending' : 'running';
  if (batch.status !== expectedStatus) context.addIssue({ code: 'custom',
    message: `batch status must be ${expectedStatus} for its progress counts`,
    path: ['status'] });
});
export type H3JobBatch = z.infer<typeof H3JobBatchSchema>;

export const CreateH3JobBatchResultSchema = z.object({
  project_id: IdSchema,
  batch: H3JobBatchSchema,
  items: z.array(z.object({ shot_plan_id: IdSchema, job: H3JobSchema })),
});
export type CreateH3JobBatchResult = z.infer<
  typeof CreateH3JobBatchResultSchema
>;

export const H3JobBatchListSchema = z.object({
  project_id: IdSchema,
  batches: z.array(H3JobBatchSchema),
});
export type H3JobBatchList = z.infer<typeof H3JobBatchListSchema>;

export const RetryH3JobResultSchema = z.object({
  project_id: IdSchema,
  job: H3JobSchema,
  batch: H3JobBatchSchema.nullable(),
});
export type RetryH3JobResult = z.infer<typeof RetryH3JobResultSchema>;
