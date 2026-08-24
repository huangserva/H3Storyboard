import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../../apps/studio/src/lib/bounded-map.js';

describe('bounded async map', () => {
  it('preserves input order without exceeding the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2,
      async (value) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return value * 10;
      });

    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
  });
});
