import { randomUUID } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import { ComfyUIClient } from '../../packages/h3-provider/src/index.js';
import { SharedGpuCoordinator } from '../../packages/task-engine/src/index.js';

describe('shared GPU coordination', () => {
  test('acquires the durable host lease before checking or freeing endpoints',
    async () => {
      const order: string[] = [];
      const leaseToken = randomUUID();
      const leaseStore = {
        acquire: vi.fn(() => { order.push('acquire'); return {
          gpu_host: 'newgpu:0', owner_kind: 'character_image' as const,
          owner_job_id: randomUUID(), lease_token: leaseToken,
          lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
          heartbeat_at: new Date().toISOString(), created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }; }),
        heartbeat: vi.fn(), release: vi.fn(),
      };
      const endpoint = (name: string) => ({
        assertQueueIdle: vi.fn(async () => { order.push(`queue:${name}`); }),
        free: vi.fn(async () => { order.push(`free:${name}`); }),
        assertFreeVram: vi.fn(async () => { order.push(`vram:${name}`); return {
          device_name: '4090', total_bytes: 48 * 1024 ** 3,
          free_bytes: 20 * 1024 ** 3,
        }; }),
      });
      const krea = endpoint('krea');
      const h3 = endpoint('h3');
      const coordinator = new SharedGpuCoordinator({ lease_store: leaseStore,
        gpu_host: 'newgpu:0', queue_clients: [krea, h3],
        managed_free_clients: [krea, h3], memory_client: krea,
        minimum_free_vram_bytes: 17 * 1024 ** 3, settle_ms: 0 });

      const lease = coordinator.acquire('character_image', randomUUID());
      await coordinator.prepareNewSubmission();
      coordinator.release(lease.lease_token);

      expect(order).toEqual(['acquire', 'queue:krea', 'queue:h3',
        'queue:krea', 'queue:h3',
        'free:krea', 'free:h3', 'vram:krea']);
      expect(leaseStore.release).toHaveBeenCalledWith('newgpu:0', leaseToken);
    });

  test('does not free any endpoint when a peer queue is occupied', async () => {
    const current = { assertQueueIdle: vi.fn(async () => undefined),
      free: vi.fn(async () => undefined),
      assertFreeVram: vi.fn(async () => ({ device_name: '4090',
        total_bytes: 1, free_bytes: 1 })) };
    const busy = new Error('peer busy');
    const peer = { ...current, assertQueueIdle: vi.fn(async () => {
      throw busy;
    }), free: vi.fn(async () => undefined) };
    const coordinator = new SharedGpuCoordinator({
      lease_store: { acquire: vi.fn(), heartbeat: vi.fn(), release: vi.fn() },
      gpu_host: 'newgpu:0', queue_clients: [current, peer],
      managed_free_clients: [current, peer], memory_client: current,
      minimum_free_vram_bytes: 0, settle_ms: 0,
    });

    await expect(coordinator.prepareNewSubmission()).rejects.toBe(busy);
    expect(current.free).not.toHaveBeenCalled();
    expect(peer.free).not.toHaveBeenCalled();
  });

  test('rechecks every queue after capability work before freeing', async () => {
    let checks = 0;
    const endpoint = { assertQueueIdle: vi.fn(async () => {
      checks += 1;
      if (checks === 2) throw new Error('late external task');
    }), assertQueueCompatible: vi.fn(), free: vi.fn(),
    assertFreeVram: vi.fn() };
    const coordinator = new SharedGpuCoordinator({
      lease_store: { acquire: vi.fn(), heartbeat: vi.fn(), release: vi.fn() },
      gpu_host: 'newgpu:0', queue_clients: [endpoint],
      managed_free_clients: [endpoint], memory_client: endpoint,
      minimum_free_vram_bytes: 0, settle_ms: 0,
    });

    await expect(coordinator.prepareNewSubmission(async () => undefined))
      .rejects.toThrow('late external task');
    expect(endpoint.free).not.toHaveBeenCalled();
  });

  test('recovery allows only the owned prompt and requires every peer idle',
    async () => {
      const current = { assertQueueIdle: vi.fn(),
        assertQueueCompatible: vi.fn(async () => undefined),
        free: vi.fn(), assertFreeVram: vi.fn() };
      const peer = { assertQueueIdle: vi.fn(async () => undefined),
        assertQueueCompatible: vi.fn(), free: vi.fn(),
        assertFreeVram: vi.fn() };
      const coordinator = new SharedGpuCoordinator({
        lease_store: { acquire: vi.fn(), heartbeat: vi.fn(), release: vi.fn() },
        gpu_host: 'newgpu:0', queue_clients: [current, peer],
        managed_free_clients: [current, peer], memory_client: current,
        minimum_free_vram_bytes: 0, settle_ms: 0,
      });

      await coordinator.prepareRecovery(current, 'owned-prompt');

      expect(current.assertQueueCompatible).toHaveBeenCalledWith('owned-prompt');
      expect(current.assertQueueIdle).not.toHaveBeenCalled();
      expect(peer.assertQueueIdle).toHaveBeenCalledOnce();
      expect(current.free).not.toHaveBeenCalled();
      expect(peer.free).not.toHaveBeenCalled();
    });

  test('treats clients for the same endpoint as one shared queue', async () => {
    const imageClient = { endpoint: 'http://comfy.test/',
      assertQueueIdle: vi.fn(async () => undefined),
      assertQueueCompatible: vi.fn(async () => undefined),
      free: vi.fn(), assertFreeVram: vi.fn() };
    const videoClient = { endpoint: 'http://comfy.test',
      assertQueueIdle: vi.fn(async () => undefined),
      assertQueueCompatible: vi.fn(async () => undefined),
      free: vi.fn(), assertFreeVram: vi.fn() };
    const coordinator = new SharedGpuCoordinator({
      lease_store: { acquire: vi.fn(), heartbeat: vi.fn(), release: vi.fn() },
      gpu_host: 'newgpu:0', queue_clients: [imageClient, videoClient],
      managed_free_clients: [], memory_client: imageClient,
      minimum_free_vram_bytes: 0, settle_ms: 0,
    });

    await coordinator.prepareRecovery(videoClient, 'owned-prompt');

    expect(videoClient.assertQueueCompatible).toHaveBeenCalledWith(
      'owned-prompt');
    expect(imageClient.assertQueueIdle).not.toHaveBeenCalled();
  });

  test('rejects a GPU lease that cannot span one provider poll interval', () => {
    const client = new ComfyUIClient({ endpoint: 'http://krea.test',
      poll_interval_ms: 1_000 });
    expect(() => new SharedGpuCoordinator({
      lease_store: { acquire: vi.fn(), heartbeat: vi.fn(), release: vi.fn() },
      gpu_host: 'newgpu:0', queue_clients: [client],
      managed_free_clients: [], memory_client: client,
      minimum_free_vram_bytes: 0, lease_duration_ms: 1_000,
    })).toThrow('GPU lease must be longer than every ComfyUI client poll interval');
  });
});
