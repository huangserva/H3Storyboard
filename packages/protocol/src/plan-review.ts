import { z } from 'zod';
import { IdSchema, NonEmptyTextSchema } from './common.js';
import {
  ScriptBeatSchema,
  ScriptCompilationSchema,
  ScriptSceneSchema,
} from './script.js';
import { ShotPlanSchema } from './shot.js';

export const PlanReviewChangedFieldSchema = z.enum([
  'title',
  'duration_seconds',
  'shot_size',
  'camera_movement',
  'action',
  'dialogue',
  'prompt',
  'costume_state',
  'position_state',
  'prop_state',
]);
export type PlanReviewChangedField = z.infer<
  typeof PlanReviewChangedFieldSchema
>;

export const PlanReviewChangeSchema = z.object({
  kind: z.enum(['added', 'changed', 'unchanged']),
  baseline_shot_plan_id: IdSchema.nullable(),
  changed_fields: z.array(PlanReviewChangedFieldSchema),
});
export type PlanReviewChange = z.infer<typeof PlanReviewChangeSchema>;

export const PlanReviewItemSchema = z.object({
  shot_plan: ShotPlanSchema,
  source_scene: ScriptSceneSchema.omit({ beats: true }),
  source_beats: z.array(ScriptBeatSchema),
  change: PlanReviewChangeSchema,
});
export type PlanReviewItem = z.infer<typeof PlanReviewItemSchema>;

export const PlanReviewSchema = z.object({
  compilation: ScriptCompilationSchema,
  active_compilation_id: IdSchema.nullable(),
  items: z.array(PlanReviewItemSchema),
  removed_shot_plans: z.array(ShotPlanSchema),
  can_approve: z.boolean(),
});
export type PlanReview = z.infer<typeof PlanReviewSchema>;

const reviewEditableFields = {
  title: NonEmptyTextSchema.max(160).optional(),
  duration_seconds: z.number().min(4).max(15).optional(),
  shot_size: NonEmptyTextSchema.max(80).optional(),
  camera_movement: NonEmptyTextSchema.max(200).optional(),
  action: NonEmptyTextSchema.max(1_200).optional(),
  dialogue: z.string().max(1_200).optional(),
  prompt: z.string().max(7_000).optional(),
  costume_state: z.record(z.string(), z.string()).optional(),
  position_state: z.record(z.string(), z.string()).optional(),
  prop_state: z.record(z.string(), z.string()).optional(),
};

export const UpdateDraftShotPlanInputSchema = z.object({
  expected_compilation_revision: z.number().int().nonnegative(),
  expected_planning_revision: z.number().int().nonnegative(),
  ...reviewEditableFields,
}).strict().refine((value) => Object.keys(reviewEditableFields).some(
  (field) => value[field as keyof typeof reviewEditableFields] !== undefined,
), { message: 'At least one planning field must be updated' });
export type UpdateDraftShotPlanInput = z.infer<
  typeof UpdateDraftShotPlanInputSchema
>;

export const ApprovePlanReviewInputSchema = z.object({
  expected_revision: z.number().int().nonnegative(),
});
export type ApprovePlanReviewInput = z.infer<
  typeof ApprovePlanReviewInputSchema
>;
