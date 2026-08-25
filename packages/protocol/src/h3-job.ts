import { z } from 'zod';
import {
  type AssetBinding,
  AssetBindingSchema,
  IdSchema,
  NonEmptyTextSchema,
  TimestampSchema,
} from './common.js';
import { JobLockSnapshotSchema } from './production-brief.js';
import { CompiledBindingSchema } from './compiled-binding.js';

export const H3ModeSchema = z.enum([
  't2v',
  'i2v',
  'fl2v',
  'r2v',
  'v2v',
  'rv2v',
]);
export type H3Mode = z.infer<typeof H3ModeSchema>;

export const H3ProviderSchema = z.enum(['local_comfyui', 'minimax_api']);
export type H3ProviderName = z.infer<typeof H3ProviderSchema>;

export const H3AudioModeSchema = z.enum(['h3_native', 'silent']);
export type H3AudioMode = z.infer<typeof H3AudioModeSchema>;

export const H3JobStatusSchema = z.enum([
  'draft',
  'submitting',
  'queued',
  'running',
  'completed',
  'failed',
  'canceled',
  'timed_out',
]);
export type H3JobStatus = z.infer<typeof H3JobStatusSchema>;

export const H3_MAX_AUTO_ATTEMPTS = 8;

const jobFields = {
  provider: H3ProviderSchema,
  model: NonEmptyTextSchema.max(200),
  prompt: NonEmptyTextSchema.max(7_000),
  duration_seconds: z.number().min(4).max(15),
  seed: z.number().int().nonnegative().nullable().default(null),
  steps: z.number().int().min(1).max(100),
  audio_mode: H3AudioModeSchema.default('h3_native'),
  idempotency_key: NonEmptyTextSchema.min(8).max(200),
  input_bindings: z.array(AssetBindingSchema),
  gate_override_reason: NonEmptyTextSchema.max(1_000).nullable().optional(),
};

const jobModeSchemas = [
  z.object({ mode: z.literal('t2v'), ...jobFields }),
  z.object({ mode: z.literal('i2v'), ...jobFields }),
  z.object({ mode: z.literal('fl2v'), ...jobFields }),
  z.object({ mode: z.literal('r2v'), ...jobFields }),
  z.object({ mode: z.literal('v2v'), ...jobFields }),
  z.object({ mode: z.literal('rv2v'), ...jobFields }),
] as const;

export const CreateH3JobInputSchema = z
  .discriminatedUnion('mode', jobModeSchemas)
  .superRefine((input, context) => {
    for (const issue of validateH3Bindings(input.mode, input.input_bindings)) {
      context.addIssue({
        code: 'custom',
        message: `${issue.code}: ${issue.message}`,
        path: ['input_bindings'],
      });
    }
  });
export type CreateH3JobInput = z.input<typeof CreateH3JobInputSchema>;

export const H3JobSchema = z.object({
  id: IdSchema,
  project_id: IdSchema,
  shot_plan_id: IdSchema,
  mode: H3ModeSchema,
  provider: H3ProviderSchema,
  model: NonEmptyTextSchema.max(200),
  prompt: NonEmptyTextSchema.max(7_000),
  duration_seconds: z.number().min(4).max(15),
  seed: z.number().int().nonnegative().nullable(),
  steps: z.number().int().min(1).max(100),
  audio_mode: H3AudioModeSchema,
  idempotency_key: NonEmptyTextSchema,
  input_bindings: z.array(AssetBindingSchema),
  status: H3JobStatusSchema,
  attempt: z.number().int().nonnegative(),
  provider_job_id: z.string().nullable(),
  provider_client_id: z.string().nullable(),
  output_asset_id: IdSchema.nullable(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  lease_token: IdSchema.nullable(),
  lease_expires_at: TimestampSchema.nullable(),
  heartbeat_at: TimestampSchema.nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  completed_at: TimestampSchema.nullable(),
  lock_snapshot: JobLockSnapshotSchema.nullable(),
  compiled_bindings: z.array(CompiledBindingSchema).nullable(),
  gate_override_reason: NonEmptyTextSchema.max(1_000).nullable(),
  cancel_reason: NonEmptyTextSchema.max(1_000).nullable(),
});
export type H3Job = z.infer<typeof H3JobSchema>;

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
      code: z.ZodIssueCode.custom,
      message: 'shot_plan_id must be unique within a job batch',
      path: ['items', index, 'shot_plan_id'],
    });
    seen.add(item.shot_plan_id);
  });
});
export type CreateH3JobBatchInput = z.input<
  typeof CreateH3JobBatchInputSchema
>;

export const CreateH3JobBatchResultSchema = z.object({
  project_id: IdSchema,
  items: z.array(z.object({ shot_plan_id: IdSchema, job: H3JobSchema })),
});
export type CreateH3JobBatchResult = z.infer<
  typeof CreateH3JobBatchResultSchema
>;

export const GenerationPreflightSchema = z.object({
  ready: z.boolean(),
  blocking_error: z.object({
    code: z.string(),
    message: z.string(),
  }).nullable(),
  mode: H3ModeSchema.nullable(),
  input_bindings: z.array(AssetBindingSchema),
  gate_override_required: z.boolean(),
});
export type GenerationPreflight = z.infer<typeof GenerationPreflightSchema>;

export const GenerationPreflightBatchItemSchema = z.object({
  shot_plan_id: IdSchema,
  preflight: GenerationPreflightSchema,
});
export type GenerationPreflightBatchItem = z.infer<
  typeof GenerationPreflightBatchItemSchema
>;

export const GenerationPreflightBatchSchema = z.object({
  project_id: IdSchema,
  items: z.array(GenerationPreflightBatchItemSchema),
}).superRefine((value, context) => {
  const shotPlanIds = new Set<string>();
  value.items.forEach((item, index) => {
    if (shotPlanIds.has(item.shot_plan_id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'shot_plan_id must be unique within a preflight batch',
        path: ['items', index, 'shot_plan_id'],
      });
    }
    shotPlanIds.add(item.shot_plan_id);
  });
});
export type GenerationPreflightBatch = z.infer<
  typeof GenerationPreflightBatchSchema
>;

export interface BindingIssue {
  code: string;
  message: string;
}

interface ModeCapability {
  min_images: number;
  max_images: number;
  min_videos: number;
  max_videos: number;
  exact_roles?: readonly AssetBinding['role'][];
}

export const H3_MODE_CAPABILITIES: Readonly<Record<H3Mode, ModeCapability>> = {
  t2v: { min_images: 0, max_images: 0, min_videos: 0, max_videos: 0 },
  i2v: {
    min_images: 1,
    max_images: 1,
    min_videos: 0,
    max_videos: 0,
    exact_roles: ['first_frame'],
  },
  fl2v: {
    min_images: 2,
    max_images: 2,
    min_videos: 0,
    max_videos: 0,
    exact_roles: ['first_frame', 'last_frame'],
  },
  r2v: { min_images: 1, max_images: 9, min_videos: 0, max_videos: 0 },
  v2v: { min_images: 0, max_images: 0, min_videos: 1, max_videos: 3 },
  rv2v: { min_images: 1, max_images: 9, min_videos: 1, max_videos: 3 },
};

const roleKinds: Record<AssetBinding['role'], AssetBinding['asset_kind']> = {
  first_frame: 'image',
  last_frame: 'image',
  character: 'image',
  product: 'image',
  scene: 'image',
  style: 'image',
  motion: 'video',
  audio: 'audio',
};

export function validateH3Bindings(
  mode: H3Mode,
  bindings: AssetBinding[],
): BindingIssue[] {
  const issues = validateH3BindingList(bindings);
  const roles = new Map<AssetBinding['role'], number>();
  const counts = { image: 0, video: 0, audio: 0 };

  for (const binding of bindings) {
    counts[binding.asset_kind] += 1;
    roles.set(binding.role, (roles.get(binding.role) ?? 0) + 1);
  }

  const capability = H3_MODE_CAPABILITIES[mode];
  const referenceCountsValid =
    counts.image >= capability.min_images &&
    counts.image <= capability.max_images &&
    counts.video >= capability.min_videos &&
    counts.video <= capability.max_videos;
  const exactRolesValid = capability.exact_roles
    ? bindings.filter(({ asset_kind }) => asset_kind !== 'audio').length ===
        capability.exact_roles.length &&
      capability.exact_roles.every((role) => (roles.get(role) ?? 0) === 1)
    : true;
  const textOnlyValid = mode !== 't2v' || bindings.length === 0;

  if (!referenceCountsValid || !exactRolesValid || !textOnlyValid) {
    issues.push({
      code: 'H3_MODE_BINDING_MISMATCH',
      message: `Reference bindings do not satisfy ${mode}`,
    });
  }
  if (counts.audio > 0) {
    issues.push({
      code: 'H3_EXTERNAL_AUDIO_FORBIDDEN',
      message: 'H3 jobs may use only H3-native audio or silence',
    });
  }
  return issues;
}

export function validateH3BindingList(
  bindings: readonly AssetBinding[],
): BindingIssue[] {
  const issues: BindingIssue[] = [];
  const roles = new Map<AssetBinding['role'], number>();
  const counts = { image: 0, video: 0, audio: 0 };
  for (const binding of bindings) {
    counts[binding.asset_kind] += 1;
    roles.set(binding.role, (roles.get(binding.role) ?? 0) + 1);
    if (roleKinds[binding.role] !== binding.asset_kind) {
      issues.push({
        code: 'ASSET_ROLE_KIND_MISMATCH',
        message: `${binding.role} requires ${roleKinds[binding.role]}`,
      });
    }
  }
  if (bindings.some((binding, index) => binding.ordinal !== index)) {
    issues.push({
      code: 'BINDING_ORDINAL_SEQUENCE_INVALID',
      message: 'Binding ordinals must be unique and contiguous from zero',
    });
  }
  for (const uniqueRole of ['first_frame', 'last_frame'] as const) {
    if ((roles.get(uniqueRole) ?? 0) > 1) {
      issues.push({
        code: 'DUPLICATE_FRAME_ROLE',
        message: `${uniqueRole} can only be bound once`,
      });
    }
  }
  if (counts.image > 9 || counts.video > 3 || counts.audio > 3) {
    issues.push({
      code: 'H3_ASSET_TYPE_LIMIT_EXCEEDED',
      message: 'H3 accepts at most 9 images, 3 videos, and 3 audio files',
    });
  }
  if (bindings.length > 12) {
    issues.push({
      code: 'H3_TOTAL_ASSET_LIMIT_EXCEEDED',
      message: 'H3 accepts at most 12 mixed reference assets',
    });
  }
  return issues;
}

export const JobEventSchema = z.object({
  id: IdSchema,
  job_id: IdSchema,
  from_status: H3JobStatusSchema.nullable(),
  to_status: H3JobStatusSchema,
  error_code: z.string().nullable(),
  message: z.string(),
  created_at: TimestampSchema,
});
export type JobEvent = z.infer<typeof JobEventSchema>;
