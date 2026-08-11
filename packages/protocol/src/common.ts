import { z } from 'zod';

export const IdSchema = z.string().uuid();
export const TimestampSchema = z.string().datetime({ offset: true });
export const NonEmptyTextSchema = z.string().trim().min(1);

export const AssetKindSchema = z.enum(['image', 'video', 'audio']);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const AssetRoleSchema = z.enum([
  'first_frame',
  'last_frame',
  'character',
  'product',
  'scene',
  'style',
  'motion',
  'audio',
]);
export type AssetRole = z.infer<typeof AssetRoleSchema>;

export const AssetBindingSchema = z.object({
  asset_id: IdSchema,
  asset_kind: AssetKindSchema,
  role: AssetRoleSchema,
  ordinal: z.number().int().nonnegative(),
});
export type AssetBinding = z.infer<typeof AssetBindingSchema>;

export const AssetDerivationKindSchema = z.enum([
  'first_frame',
  'last_frame',
  'frame_extract',
]);

const assetFields = {
  kind: AssetKindSchema,
  name: NonEmptyTextSchema,
  relative_path: NonEmptyTextSchema.refine(
    (value) => {
      const segments = value.split(/[\\/]+/);
      return (
        !value.startsWith('/') &&
        !value.startsWith('\\') &&
        !/^[a-zA-Z]:[\\/]/.test(value) &&
        segments.every((segment) => segment !== '.' && segment !== '..')
      );
    },
    { message: 'Asset paths must be relative to the project data directory' },
  ),
  content_hash: NonEmptyTextSchema,
  derived_from_asset_id: IdSchema.nullable().default(null),
  derivation_kind: AssetDerivationKindSchema.nullable().default(null),
};

function validateAssetDerivation(
  asset: { kind: AssetKind; derived_from_asset_id: string | null; derivation_kind: string | null },
  context: z.RefinementCtx,
): void {
  const hasSource = asset.derived_from_asset_id !== null;
  const hasKind = asset.derivation_kind !== null;
  if (hasSource !== hasKind) {
    context.addIssue({
      code: 'custom',
      message: 'Derived assets require both source asset and derivation kind',
      path: ['derived_from_asset_id'],
    });
  }
  if (hasSource && asset.kind !== 'image') {
    context.addIssue({
      code: 'custom',
      message: 'Frame-derived assets must be images',
      path: ['kind'],
    });
  }
}

export const CreateAssetInputSchema = z
  .object(assetFields)
  .superRefine(validateAssetDerivation);
export type CreateAssetInput = z.input<typeof CreateAssetInputSchema>;

export const AssetSchema = z
  .object({
    ...assetFields,
    id: IdSchema,
    project_id: IdSchema,
    producer_job_id: IdSchema.nullable(),
    created_at: TimestampSchema,
  })
  .superRefine(validateAssetDerivation);
export type Asset = z.infer<typeof AssetSchema>;
