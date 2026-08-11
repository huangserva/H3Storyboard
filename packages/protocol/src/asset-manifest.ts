import { z } from 'zod';
import { IdSchema, TimestampSchema } from './common.js';

export const UpdateAssetInputSchema = z
  .object({
    asset_id: IdSchema,
    uri: z.string().trim().min(1).max(2_000).optional(),
    content_hash: z.string().trim().min(1).nullable().optional(),
    status: z.enum(['candidate', 'approved', 'archived']).optional(),
  })
  .refine(
    ({ uri, content_hash, status }) =>
      [uri, content_hash, status].some((value) => value !== undefined),
    { message: 'At least one asset field must be updated' },
  );
export type UpdateAssetInput = z.infer<typeof UpdateAssetInputSchema>;

export const CurrentAssetsManifestSchema = z.object({
  id: IdSchema,
  project_id: IdSchema,
  manifest_version: z.number().int().positive(),
  created_at: TimestampSchema,
});
export type CurrentAssetsManifest = z.infer<
  typeof CurrentAssetsManifestSchema
>;

export const ManifestEntrySchema = z.object({
  manifest_id: IdSchema,
  asset_id: IdSchema,
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export const CurrentAssetsManifestSnapshotSchema = z.object({
  manifest: CurrentAssetsManifestSchema,
  entries: z.array(ManifestEntrySchema),
});
export type CurrentAssetsManifestSnapshot = z.infer<
  typeof CurrentAssetsManifestSnapshotSchema
>;
