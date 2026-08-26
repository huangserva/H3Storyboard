import { z } from 'zod';
import { IdSchema, NonEmptyTextSchema, TimestampSchema } from './common.js';

export const ProjectStatusSchema = z.enum(['active', 'archived']);
export const ScriptVersionStatusSchema = z.enum([
  'draft',
  'locked',
  'superseded',
]);

export const ScriptVersionSchema = z.object({
  id: IdSchema,
  project_id: IdSchema,
  version: z.number().int().positive(),
  title: NonEmptyTextSchema,
  content: NonEmptyTextSchema,
  status: ScriptVersionStatusSchema,
  source_format: z.enum(['legacy_text', 'plain_text', 'shuohao_novel_script']),
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
