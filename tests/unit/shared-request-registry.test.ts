import { afterEach, describe, expect, it, vi } from 'vitest';
import { SharedRequestRegistry } from
  '../../apps/studio/src/lib/shared-request-registry.js';

afterEach(() => vi.useRealTimers());

describe('SharedRequestRegistry', () => {
  it('reuses an in-flight request across a StrictMode cleanup replay', async () => {
    vi.useFakeTimers();
    const registry = new SharedRequestRegistry<string>();
    let requests = 0;
    let finish!: (value: string) => void;
    let signal!: AbortSignal;
    const request = (currentSignal: AbortSignal) => {
      requests += 1;
      signal = currentSignal;
      return new Promise<string>((resolve) => { finish = resolve; });
    };

    const first = registry.acquire('project-a', request);
    first.release();
    const replay = registry.acquire('project-a', request);
    await vi.runAllTimersAsync();

    expect(requests).toBe(1);
    expect(signal.aborted).toBe(false);
    finish('ready');
    await expect(replay.promise).resolves.toBe('ready');
    replay.release();
  });

  it('aborts an abandoned request after the replay window', async () => {
    vi.useFakeTimers();
    const registry = new SharedRequestRegistry<string>();
    const lease = registry.acquire('project-a', (signal) =>
      new Promise<string>((_resolve, reject) => signal.addEventListener(
        'abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    const rejected = expect(lease.promise).rejects.toMatchObject({
      name: 'AbortError',
    });

    lease.release();
    await vi.runAllTimersAsync();
    await rejected;
  });
});
