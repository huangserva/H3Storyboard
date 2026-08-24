import type { GpuLease, GpuLeaseOwnerKind } from '@h3storyboard/protocol';

export interface GpuLeaseStoreLike {
  acquire(gpuHost: string, ownerKind: GpuLeaseOwnerKind,
    ownerJobId: string, leaseDurationMs?: number): GpuLease;
  heartbeat(gpuHost: string, leaseToken: string,
    leaseDurationMs?: number): GpuLease;
  release(gpuHost: string, leaseToken: string): GpuLease;
}

export interface GpuEndpointClient {
  readonly endpoint?: string;
  readonly poll_interval_ms: number;
  assertQueueIdle(signal?: AbortSignal): Promise<void>;
  assertQueueCompatible(promptId: string, signal?: AbortSignal): Promise<void>;
  free(signal?: AbortSignal): Promise<void>;
  assertFreeVram(minimumFreeBytes: number, signal?: AbortSignal): Promise<{
    device_name: string;
    total_bytes: number;
    free_bytes: number;
  }>;
}

export interface SharedGpuCoordinatorOptions {
  lease_store: GpuLeaseStoreLike;
  gpu_host: string;
  queue_clients: readonly GpuEndpointClient[];
  managed_free_clients: readonly GpuEndpointClient[];
  memory_client: GpuEndpointClient;
  minimum_free_vram_bytes: number;
  lease_duration_ms?: number;
  settle_ms?: number;
}

export class SharedGpuCoordinator {
  readonly #options: Required<SharedGpuCoordinatorOptions>;

  constructor(options: SharedGpuCoordinatorOptions) {
    if (!options.gpu_host.trim()) throw new Error('GPU host must not be empty');
    if (options.queue_clients.length === 0) throw new Error(
      'At least one queue client is required');
    this.#options = { ...options,
      lease_duration_ms: options.lease_duration_ms ?? 60 * 60_000,
      settle_ms: options.settle_ms ?? 1_000 };
    if (this.#options.queue_clients.some(({ poll_interval_ms: interval }) =>
      interval >= this.#options.lease_duration_ms)) throw new Error(
      'GPU lease must be longer than every ComfyUI client poll interval');
  }

  acquire(ownerKind: GpuLeaseOwnerKind, ownerJobId: string): GpuLease {
    return this.#options.lease_store.acquire(this.#options.gpu_host,
      ownerKind, ownerJobId, this.#options.lease_duration_ms);
  }

  heartbeat(leaseToken: string): GpuLease {
    return this.#options.lease_store.heartbeat(this.#options.gpu_host,
      leaseToken, this.#options.lease_duration_ms);
  }

  release(leaseToken: string): GpuLease {
    return this.#options.lease_store.release(this.#options.gpu_host, leaseToken);
  }

  async prepareNewSubmission(
    signal?: AbortSignal,
    afterQueuesIdle?: () => Promise<void>,
  ): Promise<void> {
    for (const client of uniqueQueueClients(this.#options.queue_clients)) {
      await (signal ? client.assertQueueIdle(signal) : client.assertQueueIdle());
    }
    await afterQueuesIdle?.();
    for (const client of uniqueQueueClients(this.#options.queue_clients)) {
      await (signal ? client.assertQueueIdle(signal) : client.assertQueueIdle());
    }
    for (const client of this.#options.managed_free_clients) {
      await (signal ? client.free(signal) : client.free());
    }
    if (this.#options.settle_ms > 0) await abortableDelay(
      this.#options.settle_ms, signal);
    if (this.#options.minimum_free_vram_bytes > 0) {
      await (signal ? this.#options.memory_client.assertFreeVram(
        this.#options.minimum_free_vram_bytes, signal) :
        this.#options.memory_client.assertFreeVram(
          this.#options.minimum_free_vram_bytes));
    }
  }

  async prepareRecovery(activeClient: GpuEndpointClient,
    promptId: string, signal?: AbortSignal): Promise<void> {
    if (!this.#options.queue_clients.some((client) =>
      sameQueue(client, activeClient))) {
      throw new Error('Recovering endpoint must belong to the shared GPU host');
    }
    for (const client of uniqueQueueClients(this.#options.queue_clients)) {
      if (sameQueue(client, activeClient)) await (signal ?
        activeClient.assertQueueCompatible(promptId, signal) :
        activeClient.assertQueueCompatible(promptId));
      else await (signal ? client.assertQueueIdle(signal) :
        client.assertQueueIdle());
    }
  }
}

function sameQueue(left: GpuEndpointClient, right: GpuEndpointClient): boolean {
  return left === right || (left.endpoint !== undefined &&
    right.endpoint !== undefined && normalizeEndpoint(left.endpoint) ===
      normalizeEndpoint(right.endpoint));
}

function uniqueQueueClients(
  clients: readonly GpuEndpointClient[],
): GpuEndpointClient[] {
  return clients.filter((client, index) =>
    clients.findIndex((candidate) => sameQueue(candidate, client)) === index);
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, '');
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}
