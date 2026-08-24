import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { ApiError, parseResponseContract } from
  '../../apps/api/src/api-error.js';

describe('parseResponseContract', () => {
  it('classifies an invalid server response as an internal contract error', () => {
    expect(() => parseResponseContract(
      z.object({ id: z.string() }), { id: 42 },
    )).toThrowError(expect.objectContaining<Partial<ApiError>>({
      status: 500,
      code: 'RESPONSE_CONTRACT_INVALID',
    }));
  });

  it('returns a valid response', () => {
    expect(parseResponseContract(
      z.object({ id: z.string() }), { id: 'asset-1' },
    )).toEqual({ id: 'asset-1' });
  });
});
