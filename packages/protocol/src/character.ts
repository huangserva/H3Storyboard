import { z } from 'zod';
import {
  AssetKindSchema,
  AssetSchema,
  IdSchema,
  NonEmptyTextSchema,
  TimestampSchema,
} from './common.js';

export const CharacterStatusSchema = z.enum([
  'candidate',
  'approved',
  'archived',
]);

const characterFields = {
  name: NonEmptyTextSchema.max(160),
  canonical_appearance: NonEmptyTextSchema.max(4_000),
  seed_family: z.array(z.number().int().nonnegative()).max(64),
  status: CharacterStatusSchema,
};

export const CreateCharacterInputSchema = z.object({
  name: characterFields.name,
  canonical_appearance: characterFields.canonical_appearance,
  seed_family: characterFields.seed_family.default([]),
  status: CharacterStatusSchema.exclude(['archived']).default('candidate'),
});
export type CreateCharacterInput = z.input<typeof CreateCharacterInputSchema>;

export const UpdateCharacterInputSchema = z
  .object({
    character_id: IdSchema,
    name: characterFields.name.optional(),
    canonical_appearance: characterFields.canonical_appearance.optional(),
    seed_family: characterFields.seed_family.optional(),
    status: CharacterStatusSchema.optional(),
  })
  .refine(
    ({ name, canonical_appearance, seed_family, status }) =>
      [name, canonical_appearance, seed_family, status].some(
        (value) => value !== undefined,
      ),
    { message: 'At least one character field must be updated' },
  );
export type UpdateCharacterInput = z.infer<typeof UpdateCharacterInputSchema>;

export const CharacterSchema = z.object({
  id: IdSchema,
  project_id: IdSchema,
  ...characterFields,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Character = z.infer<typeof CharacterSchema>;

const referenceFields = {
  asset_id: IdSchema.nullable(),
  uri: NonEmptyTextSchema.max(2_000),
  kind: AssetKindSchema,
  content_hash: NonEmptyTextSchema.nullable(),
  derived_from: IdSchema.nullable(),
  sort_order: z.number().int().nonnegative(),
};

export const CreateCharacterReferenceInputSchema = z.object({
  ...referenceFields,
  asset_id: referenceFields.asset_id.default(null),
  content_hash: referenceFields.content_hash.default(null),
  derived_from: referenceFields.derived_from.default(null),
  sort_order: referenceFields.sort_order.default(0),
});
export type CreateCharacterReferenceInput = z.input<
  typeof CreateCharacterReferenceInputSchema
>;

export const UpdateCharacterReferenceInputSchema = z
  .object({
    reference_id: IdSchema,
    asset_id: referenceFields.asset_id.optional(),
    uri: referenceFields.uri.optional(),
    kind: referenceFields.kind.optional(),
    content_hash: referenceFields.content_hash.optional(),
    derived_from: referenceFields.derived_from.optional(),
    sort_order: referenceFields.sort_order.optional(),
  })
  .refine(
    ({ asset_id, uri, kind, content_hash, derived_from, sort_order }) =>
      [asset_id, uri, kind, content_hash, derived_from, sort_order].some(
        (value) => value !== undefined,
      ),
    { message: 'At least one character reference field must be updated' },
  );
export type UpdateCharacterReferenceInput = z.infer<
  typeof UpdateCharacterReferenceInputSchema
>;

export const CharacterReferenceSchema = z.object({
  id: IdSchema,
  character_id: IdSchema,
  ...referenceFields,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type CharacterReference = z.infer<typeof CharacterReferenceSchema>;

export const CharacterAssetDerivationSchema = z.object({
  asset_id: IdSchema,
  source_asset_id: IdSchema,
  kind: z.enum(['character_angle_upload', 'identity_edit', 'variant_i2i']),
  created_at: TimestampSchema,
});
export type CharacterAssetDerivation = z.infer<
  typeof CharacterAssetDerivationSchema
>;

export const CharacterCatalogSchema = z.object({
  characters: z.array(CharacterSchema),
  references: z.array(CharacterReferenceSchema),
  assets: z.array(AssetSchema),
  asset_derivations: z.array(CharacterAssetDerivationSchema),
});
export type CharacterCatalog = z.infer<typeof CharacterCatalogSchema>;

export const CharacterReferenceUploadResultSchema = z.object({
  asset: AssetSchema,
  reference: CharacterReferenceSchema,
  asset_derivation: CharacterAssetDerivationSchema.nullable(),
  replayed: z.boolean(),
});
export type CharacterReferenceUploadResult = z.infer<
  typeof CharacterReferenceUploadResultSchema
>;

export const ApproveCharacterReferenceInputSchema = z.object({
  make_primary: z.boolean().default(true),
});
export type ApproveCharacterReferenceInput = z.input<
  typeof ApproveCharacterReferenceInputSchema
>;

export const ApproveCharacterReferenceResultSchema = z.object({
  asset: AssetSchema,
  reference: CharacterReferenceSchema,
  manifest_stale: z.boolean(),
});
export type ApproveCharacterReferenceResult = z.infer<
  typeof ApproveCharacterReferenceResultSchema
>;
