import { z } from 'zod';
import { IdSchema, NonEmptyTextSchema } from './common.js';

export const SemanticReferencePurposeSchema = z.enum([
  'first_frame', 'last_frame', 'reference_character', 'reference_prop',
  'reference_composition', 'reference_style', 'reference_stage',
  'reference_target_state',
]);
export const CompiledBindingSchema = z.object({
  slot_index: z.number().int().nonnegative(),
  purpose: SemanticReferencePurposeSchema,
  asset_id: IdSchema,
  uri: NonEmptyTextSchema.max(2_000),
});
export type CompiledBinding = z.infer<typeof CompiledBindingSchema>;
export const CompiledBindingsResultSchema = z.object({
  generation_mode: z.enum(['t2v', 'i2v', 'fl2v', 'r2v']),
  bindings: z.array(CompiledBindingSchema),
});
export type CompiledBindingsResult = z.infer<typeof CompiledBindingsResultSchema>;
