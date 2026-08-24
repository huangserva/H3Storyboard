import { z } from 'zod';
import { IdSchema, TimestampSchema } from './common.js';

export const CanvasNodeTypeSchema = z.enum(['shot_plan', 'character']);
export type CanvasNodeType = z.infer<typeof CanvasNodeTypeSchema>;

const positionFields = {
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  z_index: z.number().int().nonnegative(),
};

export const CreateCanvasNodeInputSchema = z.object({
  node_type: CanvasNodeTypeSchema,
  ref_id: IdSchema,
  ...positionFields,
});
export type CreateCanvasNodeInput = z.infer<
  typeof CreateCanvasNodeInputSchema
>;

export const UpsertCanvasNodeInputSchema = CreateCanvasNodeInputSchema.extend({
  update_position_if_untouched: z.boolean().optional().default(false),
  update_layout_if_untouched: z.boolean().optional().default(false),
});
export type UpsertCanvasNodeInput = z.input<
  typeof UpsertCanvasNodeInputSchema
>;

export const BatchUpsertCanvasNodesInputSchema = z.object({
  nodes: z.array(UpsertCanvasNodeInputSchema),
}).superRefine(({ nodes }, context) => {
  const references = new Set<string>();
  nodes.forEach((node, index) => {
    const reference = `${node.node_type}:${node.ref_id}`;
    if (references.has(reference)) {
      context.addIssue({
        code: 'custom',
        path: ['nodes', index, 'ref_id'],
        message: 'CANVAS_BATCH_DUPLICATE_REF',
      });
    }
    references.add(reference);
  });
});
export type BatchUpsertCanvasNodesInput = z.input<
  typeof BatchUpsertCanvasNodesInputSchema
>;

export const UpdateCanvasNodeInputSchema = z
  .object({
    node_id: IdSchema,
    x: positionFields.x.optional(),
    y: positionFields.y.optional(),
    width: positionFields.width.optional(),
    height: positionFields.height.optional(),
    z_index: positionFields.z_index.optional(),
  })
  .refine(
    ({ x, y, width, height, z_index }) =>
      [x, y, width, height, z_index].some((value) => value !== undefined),
    { message: 'At least one canvas node field must be updated' },
  );
export type UpdateCanvasNodeInput = z.infer<
  typeof UpdateCanvasNodeInputSchema
>;

export const CanvasNodeSchema = z.object({
  id: IdSchema,
  project_id: IdSchema,
  node_type: CanvasNodeTypeSchema,
  ref_id: IdSchema,
  ...positionFields,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type CanvasNode = z.infer<typeof CanvasNodeSchema>;

export const BatchUpsertCanvasNodesResultSchema = z.object({
  canvas_nodes: z.array(CanvasNodeSchema),
  created_count: z.number().int().nonnegative(),
  updated_count: z.number().int().nonnegative(),
});
export type BatchUpsertCanvasNodesResult = z.infer<
  typeof BatchUpsertCanvasNodesResultSchema
>;
