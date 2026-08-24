import { describe, expect, it } from 'vitest';
import { KeyedSerialQueue } from '../../apps/studio/src/lib/keyed-serial-queue.js';

describe('keyed serial queue', () => {
  it('preserves submission order for the same canvas node', async () => {
    const queue = new KeyedSerialQueue<string>();
    const events: string[] = [];
    let releaseFirst = () => undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = queue.run('shot-1', async () => {
      events.push('first:start');
      await firstGate;
      events.push('first:end');
    });
    const second = queue.run('shot-1', async () => {
      events.push('second:start');
      events.push('second:end');
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(['first:start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual([
      'first:start', 'first:end', 'second:start', 'second:end',
    ]);
  });

  it('continues later writes after an earlier write rejects', async () => {
    const queue = new KeyedSerialQueue<string>();
    const first = queue.run('shot-1', () => Promise.reject(new Error('failed')));
    const second = queue.run('shot-1', () => Promise.resolve('saved'));

    await expect(first).rejects.toThrow('failed');
    await expect(second).resolves.toBe('saved');
  });
});
