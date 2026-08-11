import { z } from 'zod';
import {
  IdSchema,
  NonEmptyTextSchema,
  TimestampSchema,
} from './common.js';
import { H3ModeSchema, H3ProviderSchema } from './h3-job.js';

export const ModeValidationStatusSchema = z.enum([
  'candidate',
  'validated',
  'blocked',
]);
export type ModeValidationStatus = z.infer<typeof ModeValidationStatusSchema>;

const RangeSchema = z.object({
  min: z.number().positive(),
  max: z.number().positive(),
}).refine(({ min, max }) => min <= max, {
  message: 'Range min must not exceed max',
});

const ResolutionRangeSchema = z.object({
  min_width: z.number().int().positive(),
  max_width: z.number().int().positive(),
  min_height: z.number().int().positive(),
  max_height: z.number().int().positive(),
}).refine(
  ({ min_width, max_width, min_height, max_height }) =>
    min_width <= max_width && min_height <= max_height,
  { message: 'Resolution minimums must not exceed maximums' },
);

export const ModeCapabilityDeclarationSchema = z.object({
  generation_modes: z.array(H3ModeSchema).min(1),
  duration_seconds: RangeSchema,
  resolution: ResolutionRangeSchema,
  lora_profile_requirements: z.array(NonEmptyTextSchema.max(240)).default([]),
  provider_requirements: z.array(H3ProviderSchema).default([]),
  extensions: z.record(z.string(), z.json()).default({}),
});
export type ModeCapabilityDeclaration = z.infer<
  typeof ModeCapabilityDeclarationSchema
>;

const ModeKeySchema = z.string().trim().min(1).max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Mode key must be kebab-case');

export const CreateModeInputSchema = z.object({
  key: ModeKeySchema,
  title: NonEmptyTextSchema.max(160),
  description: NonEmptyTextSchema.max(4_000),
  capability_declaration: ModeCapabilityDeclarationSchema,
});
export type CreateModeInput = z.infer<typeof CreateModeInputSchema>;

export const UpdateModeInputSchema = z.object({
  mode_id: IdSchema,
  title: NonEmptyTextSchema.max(160).optional(),
  description: NonEmptyTextSchema.max(4_000).optional(),
  capability_declaration: ModeCapabilityDeclarationSchema.optional(),
  validation_status: ModeValidationStatusSchema.optional(),
  evidence: NonEmptyTextSchema.max(8_000).nullable().optional(),
}).refine(
  ({ title, description, capability_declaration, validation_status, evidence }) =>
    [title, description, capability_declaration, validation_status, evidence]
      .some((value) => value !== undefined),
  { message: 'At least one mode field must be updated' },
);
export type UpdateModeInput = z.infer<typeof UpdateModeInputSchema>;

export const ModeSchema = z.object({
  id: IdSchema,
  key: ModeKeySchema,
  title: NonEmptyTextSchema.max(160),
  description: NonEmptyTextSchema.max(4_000),
  capability_declaration: ModeCapabilityDeclarationSchema,
  validation_status: ModeValidationStatusSchema,
  evidence: NonEmptyTextSchema.max(8_000).nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Mode = z.infer<typeof ModeSchema>;
