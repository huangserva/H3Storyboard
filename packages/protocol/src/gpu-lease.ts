import { z } from 'zod';
import { IdSchema, NonEmptyTextSchema, TimestampSchema } from './common.js';

export const GpuLeaseOwnerKindSchema = z.enum([
  'h3_video',
  'character_image',
]);
export type GpuLeaseOwnerKind = z.infer<typeof GpuLeaseOwnerKindSchema>;

export const GpuLeaseSchema = z.object({
  gpu_host: NonEmptyTextSchema.max(255),
  owner_kind: GpuLeaseOwnerKindSchema,
  owner_job_id: IdSchema,
  lease_token: IdSchema,
  lease_expires_at: TimestampSchema,
  heartbeat_at: TimestampSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type GpuLease = z.infer<typeof GpuLeaseSchema>;
