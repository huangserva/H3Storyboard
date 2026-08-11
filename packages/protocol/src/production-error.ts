import { z } from 'zod';

export const ProductionErrorCodeSchema = z.enum([
  'BINDING_INVALID_COMBINATION',
  'BINDING_KIND_MISMATCH',
  'MODE_BLOCKED',
]);
export type ProductionErrorCode = z.infer<typeof ProductionErrorCodeSchema>;
