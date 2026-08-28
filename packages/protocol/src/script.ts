import { z } from 'zod';
import { IdSchema, NonEmptyTextSchema, TimestampSchema } from './common.js';
import {
  ScriptGenerationReviewSchema,
  ScriptGenerationBriefSchema,
  ScriptVersionSchema,
} from './project.js';
import { ShotPlanSchema } from './shot.js';

export const ScriptSourceFormatSchema = z.enum([
  'legacy_text',
  'plain_text',
  'shuohao_novel_script',
]);
export type ScriptSourceFormat = z.infer<typeof ScriptSourceFormatSchema>;

const ScriptBeatStateFields = {
  character_refs: z.array(NonEmptyTextSchema.max(160)).default([]),
  costume_state: z.record(z.string(), z.string().max(1_000)).default({}),
  position_state: z.record(z.string(), z.string().max(1_000)).default({}),
  prop_state: z.record(z.string(), z.string().max(1_000)).default({}),
};

const ScriptBeatInputBase = z.object({
  id: IdSchema,
  ordinal: z.number().int().positive(),
  duration_seconds: z.number().positive().max(300),
  ...ScriptBeatStateFields,
});

export const ScriptBeatInputSchema = z.discriminatedUnion('kind', [
  ScriptBeatInputBase.extend({
    kind: z.literal('action'),
    text: NonEmptyTextSchema.max(4_000),
  }),
  ScriptBeatInputBase.extend({
    kind: z.literal('dialogue'),
    text: NonEmptyTextSchema.max(4_000),
    speaker: NonEmptyTextSchema.max(160),
    delivery: z.string().max(1_000).default(''),
  }),
]);
export type ScriptBeatInput = z.infer<typeof ScriptBeatInputSchema>;

export const ScriptSceneInputSchema = z.object({
  id: IdSchema,
  ordinal: z.number().int().positive(),
  scene_key: NonEmptyTextSchema.max(120),
  heading: NonEmptyTextSchema.max(300),
  location: z.string().max(300).default(''),
  time_of_day: z.string().max(160).default(''),
  lighting: z.string().max(1_000).default(''),
  summary: z.string().max(2_000).default(''),
  beats: z.array(ScriptBeatInputSchema).max(2_000),
});
export type ScriptSceneInput = z.infer<typeof ScriptSceneInputSchema>;

export const ScriptBeatSchema = ScriptBeatInputSchema.and(z.object({
  script_scene_id: IdSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
}));
export type ScriptBeat = z.infer<typeof ScriptBeatSchema>;

export const ScriptSceneSchema = ScriptSceneInputSchema.omit({ beats: true }).extend({
  script_version_id: IdSchema,
  beats: z.array(ScriptBeatSchema),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type ScriptScene = z.infer<typeof ScriptSceneSchema>;

export const ScriptDocumentSchema = z.object({
  version: ScriptVersionSchema,
  scenes: z.array(ScriptSceneSchema),
});
export type ScriptDocument = z.infer<typeof ScriptDocumentSchema>;

export const ImportScriptInputSchema = z.object({
  format: ScriptSourceFormatSchema.exclude(['legacy_text']),
  title: NonEmptyTextSchema.max(160),
  content: NonEmptyTextSchema.max(750_000),
});
export type ImportScriptInput = z.infer<typeof ImportScriptInputSchema>;

export const GenerateScriptInputSchema = ScriptGenerationBriefSchema;
export type GenerateScriptInput = z.infer<typeof GenerateScriptInputSchema>;

const GeneratedShuohaoFlowSchema = z.union([
  z.object({ action: NonEmptyTextSchema.max(4_000) }).strict(),
  z.object({
    speaker: NonEmptyTextSchema.max(160),
    line: NonEmptyTextSchema.max(1_000),
    delivery: z.string().trim().max(1_000).default(''),
  }).strict(),
]);

const GeneratedShuohaoSceneSchema = z.object({
  sceneId: NonEmptyTextSchema.max(80),
  heading: NonEmptyTextSchema.max(300),
  location: NonEmptyTextSchema.max(300),
  timeOfDay: NonEmptyTextSchema.max(160),
  lighting: z.string().trim().max(1_000).default(''),
  summary: z.string().trim().max(2_000).default(''),
  characters: z.array(NonEmptyTextSchema.max(160)).max(40),
  props: z.array(NonEmptyTextSchema.max(160)).max(80).default([]),
  flow: z.array(GeneratedShuohaoFlowSchema).min(1).max(2_000),
}).strict();

const GeneratedShuohaoEpisodeSchema = z.object({
  ep: z.number().int().positive(),
  targetSeconds: z.number().positive().max(7_200),
  hook: NonEmptyTextSchema.max(1_000),
  cliff: NonEmptyTextSchema.max(1_000),
  beatsClaimed: z.array(NonEmptyTextSchema.max(160)).max(40).default([]),
  hookBeat: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  scenes: z.array(GeneratedShuohaoSceneSchema).min(1).max(60),
}).strict();

export const GeneratedShuohaoScriptSchema = z.object({
  source: NonEmptyTextSchema.max(160),
  episodes: z.array(GeneratedShuohaoEpisodeSchema).min(1).max(10),
}).strict();
export type GeneratedShuohaoScript = z.infer<
  typeof GeneratedShuohaoScriptSchema
>;

export const ScriptGenerationCapabilitySchema = z.object({
  available: z.boolean(),
  strategy: z.literal('shuohao_v1'),
  provider: NonEmptyTextSchema.max(160).nullable(),
  model: NonEmptyTextSchema.max(240).nullable(),
});
export type ScriptGenerationCapability = z.infer<
  typeof ScriptGenerationCapabilitySchema
>;

export const ScriptGenerationMetadataSchema = z.object({
  strategy: z.literal('shuohao_v1'),
  provider: NonEmptyTextSchema.max(160),
  model: NonEmptyTextSchema.max(240),
  attempt_count: z.number().int().min(1).max(2),
  review: ScriptGenerationReviewSchema,
});
export type ScriptGenerationMetadata = z.infer<
  typeof ScriptGenerationMetadataSchema
>;

export const UpdateScriptDocumentInputSchema = z.object({
  expected_revision: z.number().int().nonnegative(),
  title: NonEmptyTextSchema.max(160),
  scenes: z.array(ScriptSceneInputSchema).min(1).max(500),
});
export type UpdateScriptDocumentInput = z.infer<
  typeof UpdateScriptDocumentInputSchema
>;

export const ScriptValidationIssueSchema = z.object({
  code: NonEmptyTextSchema.max(120),
  severity: z.enum(['error', 'warning']),
  message: NonEmptyTextSchema.max(1_000),
  scene_id: IdSchema.nullable().default(null),
  beat_id: IdSchema.nullable().default(null),
});
export type ScriptValidationIssue = z.infer<typeof ScriptValidationIssueSchema>;

export const ScriptValidationSchema = z.object({
  script_version_id: IdSchema,
  valid: z.boolean(),
  issues: z.array(ScriptValidationIssueSchema),
  statistics: z.object({
    scene_count: z.number().int().nonnegative(),
    beat_count: z.number().int().nonnegative(),
    estimated_duration_seconds: z.number().nonnegative(),
  }),
});
export type ScriptValidation = z.infer<typeof ScriptValidationSchema>;

export const ScriptGenerationResultSchema = z.object({
  document: ScriptDocumentSchema,
  validation: ScriptValidationSchema,
  generation: ScriptGenerationMetadataSchema,
});
export type ScriptGenerationResult = z.infer<
  typeof ScriptGenerationResultSchema
>;

export const LockScriptInputSchema = z.object({
  expected_revision: z.number().int().nonnegative(),
});
export type LockScriptInput = z.infer<typeof LockScriptInputSchema>;

export const CompileScriptInputSchema = z.object({
  idempotency_key: NonEmptyTextSchema.min(12).max(200),
});
export type CompileScriptInput = z.infer<typeof CompileScriptInputSchema>;

export const ScriptCompilationSchema = z.object({
  id: IdSchema,
  project_id: IdSchema,
  script_version_id: IdSchema,
  idempotency_key: NonEmptyTextSchema.max(200),
  shot_count: z.number().int().nonnegative(),
  status: z.enum(['draft', 'approved', 'superseded']),
  revision: z.number().int().nonnegative(),
  created_at: TimestampSchema,
  approved_at: TimestampSchema.nullable(),
  superseded_at: TimestampSchema.nullable(),
});
export type ScriptCompilation = z.infer<typeof ScriptCompilationSchema>;

export const ScriptCompilationResultSchema = z.object({
  compilation: ScriptCompilationSchema,
  shot_plans: z.array(ShotPlanSchema),
});
export type ScriptCompilationResult = z.infer<
  typeof ScriptCompilationResultSchema
>;
