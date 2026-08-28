import { z } from 'zod';
import { IdSchema, NonEmptyTextSchema, TimestampSchema } from './common.js';

export const ProjectStatusSchema = z.enum(['active', 'archived']);
export const ScriptVersionStatusSchema = z.enum([
  'draft',
  'locked',
  'superseded',
]);

export const ScriptGenerationReviewDecisionSchema = z.object({
  verdict: z.enum(['approve', 'approve_with_notes', 'revise']),
  summary: NonEmptyTextSchema.max(2_000),
  findings: z.array(z.object({
    severity: z.enum(['blocker', 'warning', 'note']),
    issue: NonEmptyTextSchema.max(1_000),
    evidence: NonEmptyTextSchema.max(2_000),
    suggestion: NonEmptyTextSchema.max(2_000),
  }).strict()).max(40),
}).strict();
export type ScriptGenerationReviewDecision = z.infer<
  typeof ScriptGenerationReviewDecisionSchema
>;

export const ScriptGenerationReviewSchema =
  ScriptGenerationReviewDecisionSchema.extend({
    verdict: z.enum(['approve', 'approve_with_notes']),
    provider: NonEmptyTextSchema.max(160),
    model: NonEmptyTextSchema.max(240),
    review_method: z.literal('fresh_context'),
    reviewed_revision: z.number().int().nonnegative(),
  }).strict();
export type ScriptGenerationReview = z.infer<
  typeof ScriptGenerationReviewSchema
>;

export const ScriptGenerationBriefSchema = z.object({
  title: NonEmptyTextSchema.max(160),
  premise: NonEmptyTextSchema.min(10).max(120_000),
  genre: NonEmptyTextSchema.max(120),
  target_duration_seconds: z.number().int().min(15).max(7_200),
  target_scene_count: z.number().int().min(1).max(60),
  characters: z.array(NonEmptyTextSchema.max(500)).max(40).default([]),
  tone: z.string().trim().max(1_000).default(''),
  constraints: z.string().trim().max(4_000).default(''),
});
export type ScriptGenerationBrief = z.infer<
  typeof ScriptGenerationBriefSchema
>;

export const ScriptVersionSchema = z.object({
  id: IdSchema,
  project_id: IdSchema,
  version: z.number().int().positive(),
  title: NonEmptyTextSchema,
  content: NonEmptyTextSchema,
  status: ScriptVersionStatusSchema,
  source_format: z.enum(['legacy_text', 'plain_text', 'shuohao_novel_script']),
  generation_provider: NonEmptyTextSchema.max(160).nullable(),
  generation_model: NonEmptyTextSchema.max(240).nullable(),
  generation_review: ScriptGenerationReviewSchema.nullable(),
  generation_input: ScriptGenerationBriefSchema.nullable(),
  generation_source_content: NonEmptyTextSchema.max(750_000).nullable(),
  parent_version_id: IdSchema.nullable(),
  revision: z.number().int().nonnegative(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  locked_at: TimestampSchema.nullable(),
});
export type ScriptVersion = z.infer<typeof ScriptVersionSchema>;

export const ProjectSchema = z.object({
  id: IdSchema,
  title: NonEmptyTextSchema,
  status: ProjectStatusSchema,
  active_script_version_id: IdSchema,
  active_script_compilation_id: IdSchema.nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Project = z.infer<typeof ProjectSchema>;

export const CreateProjectInputSchema = z.object({
  title: NonEmptyTextSchema.max(120),
  script_title: NonEmptyTextSchema.max(160),
  script_content: NonEmptyTextSchema.min(20),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;
