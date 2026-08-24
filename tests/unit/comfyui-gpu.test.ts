import { describe, expect, test, vi } from 'vitest';
import { ComfyUIClient } from '../../packages/h3-provider/src/index.js';

describe('ComfyUI GPU preflight', () => {
  test('returns device memory and enforces the requested free-VRAM floor',
    async () => {
      const fetchFn = vi.fn<typeof fetch>(async (input) => {
        expect(String(input)).toBe('http://krea.test/system_stats');
        return Response.json({ devices: [{ name: 'NVIDIA RTX 4090', type: 'cuda',
          index: 0, vram_total: 51_527_139_328, vram_free: 20_401_094_656,
          torch_vram_total: 50_000_000_000, torch_vram_free: 18_000_000_000 }] });
      });
      const client = new ComfyUIClient({ endpoint: 'http://krea.test',
        fetch: fetchFn });

      await expect(client.assertFreeVram(17 * 1024 ** 3)).resolves.toMatchObject({
        device_name: 'NVIDIA RTX 4090', free_bytes: 20_401_094_656,
      });
      await expect(client.assertFreeVram(20 * 1024 ** 3)).rejects.toMatchObject({
        code: 'H3_COMFY_GPU_INSUFFICIENT',
      });
    });

  test('rejects malformed system_stats instead of assuming capacity', async () => {
    const client = new ComfyUIClient({ endpoint: 'http://krea.test',
      fetch: async () => Response.json({ devices: [] }) });
    await expect(client.assertFreeVram(1)).rejects.toMatchObject({
      code: 'H3_COMFY_PROTOCOL_ERROR',
    });
  });

  test('accepts only the recovered prompt on its endpoint queue', async () => {
    const client = new ComfyUIClient({ endpoint: 'http://krea.test',
      fetch: async () => Response.json({
        queue_running: [[0, 'owned-prompt', {}, {}]], queue_pending: [],
      }) });

    await expect(client.assertQueueCompatible('owned-prompt')).resolves.toBeUndefined();
    await expect(client.assertQueueCompatible('different-prompt')).rejects
      .toMatchObject({ code: 'H3_COMFY_QUEUE_BUSY' });
  });

  test('rejects malformed queue bodies instead of treating them as idle', async () => {
    const client = new ComfyUIClient({ endpoint: 'http://krea.test',
      fetch: async () => Response.json({ queue_running: [] }) });

    await expect(client.assertQueueIdle()).rejects.toMatchObject({
      code: 'H3_COMFY_PROTOCOL_ERROR',
    });
  });

  test.each([
    ['queue', (client: ComfyUIClient, signal: AbortSignal) =>
      client.assertQueueIdle(signal)],
    ['object_info', (client: ComfyUIClient, signal: AbortSignal) =>
      client.assertGraphCapabilities({ node: { class_type: 'Test', inputs: {} } },
        signal)],
    ['system_stats', (client: ComfyUIClient, signal: AbortSignal) =>
      client.assertFreeVram(1, signal)],
    ['upload', (client: ComfyUIClient, signal: AbortSignal) =>
      client.uploadImage(new Blob([new Uint8Array([1])]), 'source.png', signal)],
    ['prompt', (client: ComfyUIClient, signal: AbortSignal) =>
      client.submitPrompt({}, 'client-id', signal)],
    ['history', (client: ComfyUIClient, signal: AbortSignal) =>
      client.pollHistory('prompt-id', { signal })],
    ['client recovery', (client: ComfyUIClient, signal: AbortSignal) =>
      client.findTaskByClientId('client-id', signal)],
    ['task lookup', (client: ComfyUIClient, signal: AbortSignal) =>
      client.taskExists('prompt-id', signal)],
    ['cancel', (client: ComfyUIClient, signal: AbortSignal) =>
      client.cancelTask('prompt-id', signal)],
    ['view', (client: ComfyUIClient, signal: AbortSignal) =>
      client.downloadOutput({ filename: 'output.png' }, signal)],
    ['free', (client: ComfyUIClient, signal: AbortSignal) =>
      client.free(signal)],
  ])('passes worker abort to the %s provider fetch', async (_name, invoke) => {
    let observedSignal: AbortSignal | null = null;
    const client = new ComfyUIClient({ endpoint: 'http://krea.test',
      poll_interval_ms: 0, fetch: async (_input, init) => {
        observedSignal = init?.signal ?? null;
        return new Promise<Response>((_resolve, reject) =>
          observedSignal!.addEventListener('abort', () =>
            reject(observedSignal!.reason), { once: true }));
      } });
    const controller = new AbortController();
    const reason = new Error('worker stopped');

    const pending = invoke(client, controller.signal);
    for (let index = 0; index < 3 && observedSignal === null; index += 1) {
      await Promise.resolve();
    }
    expect(observedSignal).toBe(controller.signal);
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });
});
