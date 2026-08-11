import type { StoreErrorCode } from './errors.js';
import { StoreError } from './errors.js';

interface SafeParser<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: unknown } };
}

export function parseInput<T>(
  parser: SafeParser<T>,
  value: unknown,
  errorCode: StoreErrorCode = 'INPUT_INVALID',
): T {
  const result = parser.safeParse(value);
  if (!result.success) {
    throw new StoreError(errorCode, 'Input does not match the protocol', {
      issues: result.error.issues,
    });
  }
  return result.data;
}
