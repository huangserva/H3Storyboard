import { z } from 'zod';
import { IdSchema, NonEmptyTextSchema, TimestampSchema } from './common.js';

export const ProductionBriefBodySchema = z.object({
  logline: NonEmptyTextSchema.max(2_000),
  style_notes: NonEmptyTextSchema.max(8_000),
  text_style_lock: NonEmptyTextSchema.max(4_000).nullable().default(null),
  hard_rules: z.array(NonEmptyTextSchema.max(1_000)).max(100),
});
export type ProductionBriefBody = z.infer<typeof ProductionBriefBodySchema>;

export const CreateProductionBriefInputSchema = z.object({
  mode_key: z.string().trim().min(1).max(120),
  body: ProductionBriefBodySchema,
});
export type CreateProductionBriefInput = z.input<
  typeof CreateProductionBriefInputSchema
>;

export const ProductionBriefSchema = z.object({
  id: IdSchema,
  project_id: IdSchema,
  brief_version: z.number().int().positive(),
  mode_key: z.string().trim().min(1).max(120),
  body: ProductionBriefBodySchema,
  created_at: TimestampSchema,
});
export type ProductionBrief = z.infer<typeof ProductionBriefSchema>;

export const ProjectGenerationLockSchema = z.object({
  project_id: IdSchema,
  engaged: z.boolean(),
  engaged_at: TimestampSchema.nullable(),
  released_at: TimestampSchema.nullable(),
  reason: NonEmptyTextSchema.max(2_000).nullable(),
});
export type ProjectGenerationLock = z.infer<
  typeof ProjectGenerationLockSchema
>;

export const UpdateProjectGenerationLockInputSchema = z.discriminatedUnion(
  'engaged',
  [
    z.object({ engaged: z.literal(true), reason: NonEmptyTextSchema.max(2_000) }),
    z.object({ engaged: z.literal(false) }),
  ],
);
export type UpdateProjectGenerationLockInput = z.infer<
  typeof UpdateProjectGenerationLockInputSchema
>;

export const JobLockSnapshotSchema = z.object({
  brief_version: z.number().int().positive(),
  manifest_version: z.number().int().positive(),
  mode_key: z.string().trim().min(1).max(120),
  locked_at: TimestampSchema,
});
export type JobLockSnapshot = z.infer<typeof JobLockSnapshotSchema>;
