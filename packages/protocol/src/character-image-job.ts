import { z } from 'zod';
import {
  IdSchema,
  NonEmptyTextSchema,
  RelativeAssetPathSchema,
  TimestampSchema,
} from './common.js';
import {
  CharacterAssetDerivationSchema,
  CharacterReferenceSchema,
} from './character.js';
import { AssetSchema } from './common.js';

export const CharacterImageOperationSchema = z.enum([
  'master_t2i',
  'identity_edit',
  'variant_i2i',
]);
export type CharacterImageOperation = z.infer<
  typeof CharacterImageOperationSchema
>;

export const CharacterImageEngineSchema = z.enum([
  'krea2',
  'qwen_image_edit_2511',
]);
export type CharacterImageEngine = z.infer<typeof CharacterImageEngineSchema>;

export const CharacterImageJobStatusSchema = z.enum([
  'draft',
  'submitting',
  'queued',
  'running',
  'completed',
  'failed',
  'canceled',
  'timed_out',
]);
export type CharacterImageJobStatus = z.infer<
  typeof CharacterImageJobStatusSchema
>;

export const CHARACTER_IMAGE_MAX_AUTO_ATTEMPTS = 8;

export const CharacterImageFailureCodeSchema = z.enum([
  'IMAGE_INPUT_MISSING',
  'IMAGE_CAPABILITY_MISMATCH',
  'IMAGE_COMFY_QUEUE_BUSY',
  'IMAGE_GPU_INSUFFICIENT',
  'IMAGE_COMFY_HTTP',
  'IMAGE_COMFY_NODE_ERROR',
  'IMAGE_COMFY_TIMEOUT',
  'IMAGE_COMFY_TASK_MISSING',
  'IMAGE_COMFY_ABORTED',
  'IMAGE_OUTPUT_MISSING',
  'IMAGE_OUTPUT_INVALID',
  'IMAGE_WORKER_FAILED',
]);
export type CharacterImageFailureCode = z.infer<
  typeof CharacterImageFailureCodeSchema
>;

const imageSize = z.number().int().min(64).max(4_096).refine(
  (value) => value % 8 === 0,
  { message: 'Image dimensions must be divisible by 8' },
);

export const CreateCharacterImageJobInputSchema = z.object({
  operation: CharacterImageOperationSchema,
  provider: z.literal('local_comfyui').default('local_comfyui'),
  engine: CharacterImageEngineSchema,
  prompt: NonEmptyTextSchema.max(7_000),
  seed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  width: imageSize,
  height: imageSize,
  steps: z.number().int().min(1).max(100),
  cfg: z.number().positive().max(30),
  sampler: NonEmptyTextSchema.max(100),
  scheduler: NonEmptyTextSchema.max(100),
  denoise: z.number().min(0).max(1).nullable().default(null),
  lora_profile: NonEmptyTextSchema.max(200).nullable().default(null),
  lora_name: NonEmptyTextSchema.max(500).nullable().default(null),
  lora_strength: z.number().min(-2).max(2).nullable().default(null),
  source_reference_ids: z.array(IdSchema).max(3).default([]),
  idempotency_key: NonEmptyTextSchema.min(8).max(200),
}).superRefine((input, context) => {
  const expectedEngine = input.operation === 'identity_edit'
    ? 'qwen_image_edit_2511' : 'krea2';
  if (input.engine !== expectedEngine) context.addIssue({
    code: z.ZodIssueCode.custom,
    message: `${input.operation} requires ${expectedEngine}`,
    path: ['engine'],
  });
  const sourceCount = input.source_reference_ids.length;
  const sourceCountValid = input.operation === 'master_t2i'
    ? sourceCount === 0
    : input.operation === 'variant_i2i'
      ? sourceCount === 1
      : sourceCount >= 1 && sourceCount <= 3;
  if (!sourceCountValid) context.addIssue({
    code: z.ZodIssueCode.custom,
    message: `${input.operation} has an invalid source-reference count`,
    path: ['source_reference_ids'],
  });
  if (new Set(input.source_reference_ids).size !== sourceCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Source reference ids must be unique and ordered',
      path: ['source_reference_ids'],
    });
  }
  if (input.operation === 'master_t2i' && input.denoise !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Text-to-image jobs cannot set denoise',
      path: ['denoise'],
    });
  }
  if (input.operation !== 'master_t2i' && input.denoise === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${input.operation} requires an explicit denoise value`,
      path: ['denoise'],
    });
  }
  const loraFields = [input.lora_profile, input.lora_name,
    input.lora_strength];
  if (loraFields.some((value) => value !== null) &&
    loraFields.some((value) => value === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'LoRA profile, name, and strength must be supplied together',
      path: ['lora_profile'],
    });
  }
});
export type CreateCharacterImageJobInput = z.input<
  typeof CreateCharacterImageJobInputSchema
>;
export type ParsedCharacterImageJobInput = z.output<
  typeof CreateCharacterImageJobInputSchema
>;

export const RetryCharacterImageJobInputSchema = z.object({
  idempotency_key: NonEmptyTextSchema.min(8).max(200),
});
export type RetryCharacterImageJobInput = z.infer<
  typeof RetryCharacterImageJobInputSchema
>;

export const CharacterImageSourceInputSchema = z.object({
  reference_id: IdSchema,
  asset_id: IdSchema,
  content_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
export type CharacterImageSourceInput = z.infer<
  typeof CharacterImageSourceInputSchema
>;

export const CharacterImageJobSchema = z.object({
  id: IdSchema,
  project_id: IdSchema,
  character_id: IdSchema,
  retry_of_job_id: IdSchema.nullable(),
  operation: CharacterImageOperationSchema,
  provider: z.literal('local_comfyui'),
  engine: CharacterImageEngineSchema,
  prompt: NonEmptyTextSchema.max(7_000),
  seed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  width: imageSize,
  height: imageSize,
  steps: z.number().int().min(1).max(100),
  cfg: z.number().positive().max(30),
  sampler: NonEmptyTextSchema.max(100),
  scheduler: NonEmptyTextSchema.max(100),
  denoise: z.number().min(0).max(1).nullable(),
  lora_profile: z.string().nullable(),
  lora_name: z.string().nullable(),
  lora_strength: z.number().nullable(),
  source_inputs: z.array(CharacterImageSourceInputSchema).max(3),
  idempotency_key: NonEmptyTextSchema,
  status: CharacterImageJobStatusSchema,
  attempt: z.number().int().nonnegative(),
  provider_client_id: z.string().nullable(),
  provider_job_id: z.string().nullable(),
  output_asset_id: IdSchema.nullable(),
  output_reference_id: IdSchema.nullable(),
  error_code: CharacterImageFailureCodeSchema.nullable(),
  error_message: z.string().nullable(),
  cancel_reason: z.string().nullable(),
  lease_token: IdSchema.nullable(),
  lease_expires_at: TimestampSchema.nullable(),
  heartbeat_at: TimestampSchema.nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  completed_at: TimestampSchema.nullable(),
}).superRefine((job, context) => {
  const expectedEngine = job.operation === 'identity_edit'
    ? 'qwen_image_edit_2511' : 'krea2';
  if (job.engine !== expectedEngine) context.addIssue({
    code: z.ZodIssueCode.custom,
    message: `${job.operation} persisted an incompatible engine`,
    path: ['engine'],
  });
  const sourceCount = job.source_inputs.length;
  const sourceCountValid = job.operation === 'master_t2i'
    ? sourceCount === 0
    : job.operation === 'variant_i2i'
      ? sourceCount === 1
      : sourceCount >= 1 && sourceCount <= 3;
  if (!sourceCountValid) context.addIssue({
    code: z.ZodIssueCode.custom,
    message: `${job.operation} has an invalid persisted source count`,
    path: ['source_inputs'],
  });
  if ((job.operation === 'master_t2i') !== (job.denoise === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${job.operation} has an invalid persisted denoise value`,
      path: ['denoise'],
    });
  }
  const sourceIds = job.source_inputs.map(({ reference_id }) => reference_id);
  if (new Set(sourceIds).size !== sourceIds.length) context.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'Persisted source references must be unique',
    path: ['source_inputs'],
  });
  const loraFields = [job.lora_profile, job.lora_name, job.lora_strength];
  if (loraFields.some((value) => value !== null) &&
    loraFields.some((value) => value === null)) context.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'Persisted LoRA settings must be complete',
    path: ['lora_profile'],
  });
});
export type CharacterImageJob = z.infer<typeof CharacterImageJobSchema>;

export const CharacterImageJobEventSchema = z.object({
  id: IdSchema,
  job_id: IdSchema,
  from_status: CharacterImageJobStatusSchema.nullable(),
  to_status: CharacterImageJobStatusSchema,
  error_code: CharacterImageFailureCodeSchema.nullable(),
  message: z.string(),
  created_at: TimestampSchema,
});
export type CharacterImageJobEvent = z.infer<
  typeof CharacterImageJobEventSchema
>;

export const FinalizeCharacterImageOutputInputSchema = z.object({
  name: NonEmptyTextSchema.max(240),
  relative_path: RelativeAssetPathSchema.max(2_000),
  content_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
export type FinalizeCharacterImageOutputInput = z.infer<
  typeof FinalizeCharacterImageOutputInputSchema
>;

export const CharacterImageOutputResultSchema = z.object({
  job: CharacterImageJobSchema,
  asset: AssetSchema,
  reference: CharacterReferenceSchema,
  asset_derivation: CharacterAssetDerivationSchema.nullable(),
});
export type CharacterImageOutputResult = z.infer<
  typeof CharacterImageOutputResultSchema
>;
