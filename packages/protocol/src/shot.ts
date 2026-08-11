import { z } from 'zod';
import {
  AssetBindingSchema,
  IdSchema,
  NonEmptyTextSchema,
  TimestampSchema,
} from './common.js';
import { validateH3BindingList } from './h3-job.js';

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
  continuity_mode: ContinuityModeSchema.default('independent'),
  continuity_dependencies: z.array(ContinuityDependencySchema).default([]),
  costume_state: z.record(z.string(), z.string()).default({}),
  reference_bindings: z.array(AssetBindingSchema).default([]),
};

function addShotPlanIssues(
  value: {
    continuity_mode: z.infer<typeof ContinuityModeSchema>;
    continuity_dependencies: z.infer<typeof ContinuityDependencySchema>[];
    reference_bindings: z.infer<typeof AssetBindingSchema>[];
  },
  context: z.RefinementCtx,
): void {
  for (const issue of validateH3BindingList(value.reference_bindings)) {
    context.addIssue({
      code: 'custom',
      message: `${issue.code}: ${issue.message}`,
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
  .superRefine(addShotPlanIssues);
export type CreateShotPlanInput = z.infer<typeof CreateShotPlanInputSchema>;

export const ShotPlanSchema = z
  .object({
    ...shotPlanFields,
    id: IdSchema,
    project_id: IdSchema,
    script_version_id: IdSchema,
    ordinal: z.number().int().positive(),
    created_at: TimestampSchema,
    updated_at: TimestampSchema,
  })
  .superRefine(addShotPlanIssues);
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

export const ShotActualSchema = z.object({
  ...shotActualFields,
  qc_verdict: QcVerdictSchema,
  id: IdSchema,
  project_id: IdSchema,
  shot_plan_id: IdSchema,
  attempt_number: z.number().int().positive(),
  created_at: TimestampSchema,
  reviewed_at: TimestampSchema.nullable(),
});
export type ShotActual = z.infer<typeof ShotActualSchema>;
