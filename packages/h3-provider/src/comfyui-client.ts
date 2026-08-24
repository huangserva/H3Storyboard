import { randomUUID } from 'node:crypto';
import {
  H3ComfyError,
  type ComfyGraph,
  type ComfyHistoryEntry,
  type ComfyOutputItem,
} from './comfyui-types.js';
import { discoverGraphCapabilities } from './comfyui-capabilities.js';
import {
  delay,
  findTaskByClientId,
  firstImageOutput,
  firstOutput,
  httpError,
  isRecord,
  optionalStringField,
  parseJson,
  queueContainsPrompt,
  queueHasEntries,
  queueListContains,
  queuePromptIds,
  requestSignal,
  stringField,
} from './comfyui-client-helpers.js';

export interface ComfyUIClientOptions {
  endpoint: string;
  fetch?: typeof globalThis.fetch;
  poll_interval_ms?: number;
  poll_max_attempts?: number;
  client_id_factory?: () => string;
}

export interface PollHistoryOptions {
  signal?: AbortSignal;
  on_attempt?: (attempt: number) => void | Promise<void>;
  missing_max_attempts?: number;
  max_attempts?: number;
}

export interface ComfyGpuMemory {
  device_name: string;
  total_bytes: number;
  free_bytes: number;
}

export class ComfyUIClient {
  readonly #endpoint: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #pollIntervalMs: number;
  readonly #pollMaxAttempts: number;
  readonly #clientIdFactory: () => string;

  constructor(options: ComfyUIClientOptions) {
    this.#endpoint = options.endpoint.replace(/\/+$/, '');
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#pollIntervalMs = options.poll_interval_ms ?? 6_000;
    this.#pollMaxAttempts = options.poll_max_attempts ?? 120;
    this.#clientIdFactory = options.client_id_factory ?? randomUUID;
  }

  get poll_window_ms(): number {
    return this.#pollIntervalMs * this.#pollMaxAttempts;
  }
  get poll_interval_ms(): number { return this.#pollIntervalMs; }
  get endpoint(): string { return this.#endpoint; }

  createClientId(): string { return this.#clientIdFactory(); }

  async assertGraphCapabilities(graph: ComfyGraph,
    signal?: AbortSignal): Promise<void> {
    const evidence = await discoverGraphCapabilities(
      this.#endpoint, graph, this.#fetch, signal);
    if (!evidence.ready) throw new H3ComfyError(
      'H3_COMFY_CAPABILITY_MISMATCH',
      'ComfyUI does not provide every node required by the selected graph', {
        missing_nodes: Object.entries(evidence.nodes).flatMap(
          ([node, status]) => status === 'missing' ? [node] : []),
      });
  }

  async assertQueueIdle(signal?: AbortSignal): Promise<void> {
    const response = await this.#fetch(`${this.#endpoint}/queue`,
      requestSignal(signal));
    const body = await parseJson(response, 'inspect queue');
    if (queueHasEntries(body)) throw new H3ComfyError(
      'H3_COMFY_QUEUE_BUSY',
      'ComfyUI queue is occupied; H3Storyboard will wait without freeing or submitting');
  }

  async assertQueueCompatible(promptId: string,
    signal?: AbortSignal): Promise<void> {
    const response = await this.#fetch(`${this.#endpoint}/queue`,
      requestSignal(signal));
    const body = await parseJson(response, 'inspect queue');
    const promptIds = queuePromptIds(body);
    if (promptIds.some((queuedPromptId) => queuedPromptId !== promptId)) {
      throw new H3ComfyError('H3_COMFY_QUEUE_BUSY',
        'ComfyUI queue contains a task not owned by the recovering job', {
          prompt_id: promptId, queued_prompt_ids: promptIds,
        });
    }
  }

  async assertFreeVram(minimumFreeBytes: number,
    signal?: AbortSignal): Promise<ComfyGpuMemory> {
    if (!Number.isSafeInteger(minimumFreeBytes) || minimumFreeBytes < 0) {
      throw new H3ComfyError('H3_COMFY_PROTOCOL_ERROR',
        'Minimum free VRAM must be a non-negative safe integer');
    }
    const body = await parseJson(await this.#fetch(
      `${this.#endpoint}/system_stats`, requestSignal(signal)),
    'inspect system stats');
    const devices = body.devices;
    if (!Array.isArray(devices)) throw new H3ComfyError(
      'H3_COMFY_PROTOCOL_ERROR', 'ComfyUI system stats omitted devices');
    const candidates = devices.flatMap((device) => {
      if (!isRecord(device) || device.type !== 'cuda' ||
        typeof device.name !== 'string' ||
        typeof device.vram_total !== 'number' ||
        typeof device.vram_free !== 'number' ||
        !Number.isFinite(device.vram_total) || !Number.isFinite(device.vram_free)) {
        return [];
      }
      return [{ device_name: device.name, total_bytes: device.vram_total,
        free_bytes: device.vram_free }];
    }).sort((left, right) => right.free_bytes - left.free_bytes);
    const memory = candidates[0];
    if (!memory) throw new H3ComfyError('H3_COMFY_PROTOCOL_ERROR',
      'ComfyUI system stats contained no valid CUDA device');
    if (memory.free_bytes < minimumFreeBytes) throw new H3ComfyError(
      'H3_COMFY_GPU_INSUFFICIENT',
      'ComfyUI GPU does not have enough free VRAM for this job', {
        minimum_free_bytes: minimumFreeBytes, free_bytes: memory.free_bytes,
        device_name: memory.device_name,
      });
    return memory;
  }

  async uploadImage(image: Blob, filename: string,
    signal?: AbortSignal): Promise<string> {
    const form = new FormData();
    form.append('image', image, filename);
    form.append('overwrite', 'true');
    const response = await this.#fetch(`${this.#endpoint}/upload/image`, {
      method: 'POST', body: form, ...(signal ? { signal } : {}),
    });
    const body = await parseJson(response, 'upload image');
    const name = stringField(body, 'name', 'upload image');
    const subfolder = optionalStringField(body, 'subfolder', 'upload image');
    return subfolder ? `${subfolder}/${name}` : name;
  }

  async submitPrompt(graph: ComfyGraph, clientId = this.createClientId(),
    signal?: AbortSignal): Promise<string> {
    const response = await this.#fetch(`${this.#endpoint}/prompt`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: clientId }),
      ...(signal ? { signal } : {}),
    });
    const body = await parseJson(response, 'submit prompt');
    if (isRecord(body.node_errors) && Object.keys(body.node_errors).length > 0) {
      throw new H3ComfyError('H3_COMFY_PROTOCOL_ERROR',
        'ComfyUI rejected graph nodes', { node_errors: body.node_errors });
    }
    return stringField(body, 'prompt_id', 'submit prompt');
  }

  async pollHistory(promptId: string,
    options: PollHistoryOptions = {}): Promise<ComfyHistoryEntry> {
    let missing = 0;
    const maxAttempts = options.max_attempts ?? this.#pollMaxAttempts;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await delay(this.#pollIntervalMs, options.signal);
      await options.on_attempt?.(attempt + 1);
      const response = await this.#fetch(
        `${this.#endpoint}/history/${encodeURIComponent(promptId)}`,
        requestSignal(options.signal));
      if (!response.ok) continue;
      const body = await response.json() as unknown;
      if (!isRecord(body) || !isRecord(body[promptId])) {
        missing = await this.taskExists(promptId, options.signal) ? 0 : missing + 1;
        if (missing >= (options.missing_max_attempts ?? 3)) {
          throw new H3ComfyError('H3_COMFY_TASK_MISSING',
            'ComfyUI task is absent from history and queue', { prompt_id: promptId });
        }
        continue;
      }
      const history = body[promptId] as unknown as ComfyHistoryEntry;
      if (history.status?.status_str === 'error') {
        throw new H3ComfyError('H3_COMFY_PROTOCOL_ERROR',
          'ComfyUI execution failed', { status: history.status });
      }
      if (history.status?.completed || history.outputs) {
        if (!history.outputs || Object.keys(history.outputs).length === 0) {
          throw new H3ComfyError('H3_COMFY_OUTPUT_MISSING',
            'Completed ComfyUI history contains no outputs', { prompt_id: promptId });
        }
        return history;
      }
    }
    throw new H3ComfyError('H3_COMFY_TIMEOUT',
      'ComfyUI history polling reached its attempt limit', {
        prompt_id: promptId, max_attempts: maxAttempts,
      });
  }

  async findTaskByClientId(clientId: string,
    signal?: AbortSignal, confirmationAttempts = 1): Promise<string | null> {
    return findTaskByClientId(this.#endpoint, clientId, this.#fetch,
      this.#pollIntervalMs, signal, confirmationAttempts);
  }

  async taskExists(promptId: string, signal?: AbortSignal,
    confirmationAttempts = 1): Promise<boolean> {
    for (let attempt = 0; attempt < confirmationAttempts; attempt += 1) {
      const history = await this.#fetch(
        `${this.#endpoint}/history/${encodeURIComponent(promptId)}`,
        requestSignal(signal));
      if (history.ok) {
        const historyBody = await history.json() as unknown;
        if (isRecord(historyBody) && isRecord(historyBody[promptId])) return true;
      }
      const queue = await this.#fetch(`${this.#endpoint}/queue`, requestSignal(signal));
      if (!queue.ok) return true;
      const body = await queue.json() as unknown;
      if (queueContainsPrompt(body, promptId)) return true;
      if (attempt + 1 < confirmationAttempts) await delay(this.#pollIntervalMs, signal);
    }
    return false;
  }

  async cancelTask(promptId: string, signal?: AbortSignal): Promise<void> {
    const state = await this.#fetch(`${this.#endpoint}/queue`,
      requestSignal(signal));
    if (!state.ok) throw await httpError(state, 'inspect queue');
    const body = await state.json() as unknown;
    queuePromptIds(body);
    if (queueListContains(body, 'queue_pending', promptId)) {
      const deleted = await this.#fetch(`${this.#endpoint}/queue`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ delete: [promptId] }),
        ...(signal ? { signal } : {}),
      });
      if (!deleted.ok) throw await httpError(deleted, 'delete queued prompt');
    }
    if (queueListContains(body, 'queue_running', promptId)) {
      const interrupt = await this.#fetch(`${this.#endpoint}/interrupt`,
        { method: 'POST', ...(signal ? { signal } : {}) });
      if (!interrupt.ok) throw await httpError(interrupt, 'interrupt prompt');
    }
  }

  firstOutput(history: ComfyHistoryEntry): ComfyOutputItem {
    return firstOutput(history);
  }

  firstImageOutput(history: ComfyHistoryEntry): ComfyOutputItem {
    return firstImageOutput(history);
  }

  viewUrl(item: ComfyOutputItem): string {
    const query = new URLSearchParams({ filename: item.filename,
      subfolder: item.subfolder ?? '', type: item.type ?? 'output' });
    return `${this.#endpoint}/view?${query.toString()}`;
  }

  async downloadOutput(item: ComfyOutputItem,
    signal?: AbortSignal): Promise<Uint8Array> {
    const response = await this.#fetch(this.viewUrl(item), requestSignal(signal));
    if (!response.ok) throw await httpError(response, 'download output');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) throw new H3ComfyError(
      'H3_COMFY_EMPTY_DOWNLOAD', 'Downloaded ComfyUI output is empty', {
        filename: item.filename,
      });
    return bytes;
  }

  async free(signal?: AbortSignal): Promise<void> {
    const response = await this.#fetch(`${this.#endpoint}/free`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw await httpError(response, 'free memory');
  }
}
