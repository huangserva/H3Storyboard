import { z } from 'zod';
import {
  AssetBindingSchema,
  IdSchema,
  NonEmptyTextSchema,
  TimestampSchema,
} from './common.js';
import { validateH3BindingList } from './h3-job.js';
import { SemanticReferencePurposeSchema } from './compiled-binding.js';

export const SemanticReferenceSchema = z.object({
  purpose: SemanticReferencePurposeSchema,
  target: z.discriminatedUnion('type', [
    z.object({ type: z.literal('character'), character_id: IdSchema }),
    z.object({ type: z.literal('asset'), asset_id: IdSchema }),
  ]),
});
export type SemanticReference = z.infer<typeof SemanticReferenceSchema>;

const CharacterStateSchema = z.object({
  character_id: IdSchema,
  position: NonEmptyTextSchema.max(500),
  appearance_state: NonEmptyTextSchema.max(1_000),
});
const PropStateSchema = z.object({
  name: NonEmptyTextSchema.max(200),
  custody: NonEmptyTextSchema.max(500),
  damage: NonEmptyTextSchema.max(500),
});
export const ShotStateSchema = z.object({
  characters: z.array(CharacterStateSchema),
  props: z.array(PropStateSchema),
  scene_state: NonEmptyTextSchema.max(2_000),
  sound_handoff: NonEmptyTextSchema.max(1_000),
});
export type ShotState = z.infer<typeof ShotStateSchema>;


export const ContinuityModeSchema = z.enum([
  'independent',
  'visual_match',
  'chained',
]);

export const ContinuityBoundarySchema = z.enum([
  'first_frame',
  'last_frame',
  'full_video',
]);

export const ContinuityDependencySchema = z.object({
  source_shot_plan_id: IdSchema,
  source_take_id: IdSchema,
  reference_asset_id: IdSchema,
  boundary: ContinuityBoundarySchema,
});
export type ContinuityDependency = z.infer<
  typeof ContinuityDependencySchema
>;

/**
 * Structured source for the H3 prompt. It is compiled into MiniMax's official
 * prompt format by the h3-film-studio skill (ADR 0003); the product never
 * hand-writes the final prompt. Body fields are English; only `lines[].text`
 * carries dialogue in its original language.
 */
export const H3PromptLineSchema = z.object({
  speaker: z.string().regex(/^S[1-9]$/),
  who: NonEmptyTextSchema.max(200),
  verb: NonEmptyTextSchema.max(80),
  text: NonEmptyTextSchema.max(400),
  lang: NonEmptyTextSchema.max(40).default('Chinese'),
  after: z.string().max(400).default(''),
});
export type H3PromptLine = z.infer<typeof H3PromptLineSchema>;

/** Full-reference mode (r2v): which <Picture N> defines which <Subject N>. */
export const H3PromptSubjectSchema = z.object({
  picture: z.number().int().min(1).max(9),
  description: NonEmptyTextSchema.max(300),
});
export type H3PromptSubject = z.infer<typeof H3PromptSubjectSchema>;

export const H3PromptSpecSchema = z.object({
  subjects: z.array(H3PromptSubjectSchema).max(9).default([]),
  style: NonEmptyTextSchema.max(120),
  anchor: NonEmptyTextSchema.max(1_200),
  beats: z.array(NonEmptyTextSchema.max(600)).max(12).default([]),
  soundscape: NonEmptyTextSchema.max(800),
  lines: z.array(H3PromptLineSchema).max(12).default([]),
  silent_subjects: z.array(NonEmptyTextSchema.max(200)).max(6).default([]),
  camera: NonEmptyTextSchema.max(300).default('The camera holds a static shot'),
  music: NonEmptyTextSchema.max(400).default('N/A'),
});
export type H3PromptSpec = z.infer<typeof H3PromptSpecSchema>;

const shotPlanFields = {
  title: NonEmptyTextSchema.max(160),
  scene_id: NonEmptyTextSchema.max(120),
  duration_seconds: z.number().min(4).max(15),
  shot_size: NonEmptyTextSchema.max(80),
  camera_movement: NonEmptyTextSchema.max(200),
  action: NonEmptyTextSchema.max(1_200),
  dialogue: z.string().max(1_200).default(''),
  sound: z.string().max(1_200).default(''),
  prompt: z.string().max(7_000).default(''),
  h3_prompt_spec: H3PromptSpecSchema.nullable().default(null),
  continuity_mode: ContinuityModeSchema.default('independent'),
  continuity_dependencies: z.array(ContinuityDependencySchema).default([]),
  costume_state: z.record(z.string(), z.string()).default({}),
  position_state: z.record(z.string(), z.string()).default({}),
  prop_state: z.record(z.string(), z.string()).default({}),
  reference_bindings: z.array(AssetBindingSchema).default([]),
  semantic_references: z.array(SemanticReferenceSchema).default([]),
  opening_state: ShotStateSchema.nullable().default(null),
  ending_state: ShotStateSchema.nullable().default(null),
};

function addShotPlanIssues(
  value: {
    continuity_mode: z.infer<typeof ContinuityModeSchema>;
    continuity_dependencies: z.infer<typeof ContinuityDependencySchema>[];
    reference_bindings: z.infer<typeof AssetBindingSchema>[];
  },
  context: z.RefinementCtx,
  forbidExternalAudio: boolean,
): void {
  for (const issue of validateH3BindingList(value.reference_bindings)) {
    context.addIssue({
      code: 'custom',
      message: `${issue.code}: ${issue.message}`,
      path: ['reference_bindings'],
    });
  }
  if (forbidExternalAudio && value.reference_bindings.some(
    ({ asset_kind }) => asset_kind === 'audio')) {
    context.addIssue({
      code: 'custom',
      message: 'H3_EXTERNAL_AUDIO_FORBIDDEN: shot plans may use only H3-native audio or silence',
      path: ['reference_bindings'],
    });
  }
  if (
    (value.continuity_mode === 'independent' &&
      value.continuity_dependencies.length > 0) ||
    (value.continuity_mode !== 'independent' &&
      value.continuity_dependencies.length === 0)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'CONTINUITY_DEPENDENCY_INVALID: mode and dependencies disagree',
      path: ['continuity_dependencies'],
    });
  }
  for (const dependency of value.continuity_dependencies) {
    if (
      !value.reference_bindings.some(
        ({ asset_id }) => asset_id === dependency.reference_asset_id,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'CONTINUITY_BINDING_MISSING: dependency asset must be uploaded with this shot',
        path: ['reference_bindings'],
      });
    }
  }
}

export const CreateShotPlanInputSchema = z
  .object(shotPlanFields)
  .superRefine((value, context) => addShotPlanIssues(value, context, true));
export type CreateShotPlanInput = z.input<typeof CreateShotPlanInputSchema>;

export const UpdateShotPlanInputSchema = z.object({
  shot_plan_id: IdSchema,
  semantic_references: z.array(SemanticReferenceSchema).optional(),
  opening_state: ShotStateSchema.nullable().optional(),
  ending_state: ShotStateSchema.nullable().optional(),
  h3_prompt_spec: H3PromptSpecSchema.nullable().optional(),
}).refine(({ semantic_references, opening_state, ending_state, h3_prompt_spec }) =>
  [semantic_references, opening_state, ending_state, h3_prompt_spec]
    .some((value) => value !== undefined),
{ message: 'At least one shot production field must be updated' });
export type UpdateShotPlanInput = z.infer<typeof UpdateShotPlanInputSchema>;

export const BindShotReferenceInputSchema = z.discriminatedUnion(
  'binding_type',
  [
    z.object({
      binding_type: z.literal('semantic'),
      purpose: SemanticReferencePurposeSchema,
      target: SemanticReferenceSchema.shape.target,
    }),
    z.object({
      binding_type: z.literal('continuity'),
      purpose: z.enum(['first_frame', 'last_frame']),
      source_shot_plan_id: IdSchema,
      source_take_id: IdSchema,
      reference_asset_id: IdSchema,
      boundary: z.enum(['first_frame', 'last_frame']),
    }),
  ],
);
export type BindShotReferenceInput = z.infer<
  typeof BindShotReferenceInputSchema
>;

export const ShotPlanSchema = z
  .object({
    ...shotPlanFields,
    id: IdSchema,
    project_id: IdSchema,
    script_version_id: IdSchema,
    ordinal: z.number().int().positive(),
    planning_status: z.enum(['draft', 'approved', 'superseded']),
    planning_revision: z.number().int().nonnegative(),
    source_script_scene_id: IdSchema.nullable(),
    source_script_beat_ids: z.array(IdSchema),
    source_compilation_id: IdSchema.nullable(),
    created_at: TimestampSchema,
    updated_at: TimestampSchema,
  })
  .superRefine((value, context) => addShotPlanIssues(value, context, false));
export type ShotPlan = z.infer<typeof ShotPlanSchema>;

export const QcVerdictSchema = z.enum(['pending', 'approved', 'rejected']);

const shotActualFields = {
  job_id: IdSchema,
  output_asset_id: IdSchema,
  observed_description: NonEmptyTextSchema.max(2_000),
  deviation_notes: z.string().max(2_000).default(''),
};

export const CreateShotActualInputSchema = z.object({
  ...shotActualFields,
  qc_verdict: z.literal('pending').default('pending'),
});
export type CreateShotActualInput = z.infer<
  typeof CreateShotActualInputSchema
>;

export const ReviewShotActualInputSchema = z.object({
  qc_verdict: z.enum(['approved', 'rejected']),
  deviation_notes: z.string().max(2_000).optional(),
});
export type ReviewShotActualInput = z.infer<
  typeof ReviewShotActualInputSchema
>;

export const RepresentativeStatusSchema = z.enum([
  'none', 'pending', 'approved', 'rejected',
]);
export const MarkRepresentativeInputSchema = z.object({
  representative: z.boolean(),
});
export type MarkRepresentativeInput = z.infer<
  typeof MarkRepresentativeInputSchema
>;
export const ReviewRepresentativeInputSchema = z.object({
  representative_status: z.enum(['approved', 'rejected']),
});
export type ReviewRepresentativeInput = z.infer<
  typeof ReviewRepresentativeInputSchema
>;

export const ShotActualSchema = z.object({
  ...shotActualFields,
  qc_verdict: QcVerdictSchema,
  id: IdSchema,
  project_id: IdSchema,
  shot_plan_id: IdSchema,
  attempt_number: z.number().int().positive(),
  created_at: TimestampSchema,
  reviewed_at: TimestampSchema.nullable(),
  is_representative: z.boolean(),
  representative_status: RepresentativeStatusSchema,
  approved_at: TimestampSchema.nullable(),
});
export type ShotActual = z.infer<typeof ShotActualSchema>;
