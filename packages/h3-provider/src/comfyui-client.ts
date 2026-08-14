import { randomUUID } from 'node:crypto';
import {
  H3ComfyError,
  type ComfyGraph,
  type ComfyHistoryEntry,
  type ComfyOutputItem,
} from './comfyui-types.js';

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

  createClientId(): string { return this.#clientIdFactory(); }

  async assertQueueIdle(): Promise<void> {
    const response = await this.#fetch(`${this.#endpoint}/queue`);
    const body = await parseJson(response, 'inspect queue');
    if (queueHasEntries(body)) throw new H3ComfyError(
      'H3_COMFY_QUEUE_BUSY',
      'ComfyUI queue is occupied; H3Storyboard will wait without freeing or submitting');
  }

  async uploadImage(image: Blob, filename: string): Promise<string> {
    const form = new FormData();
    form.append('image', image, filename);
    form.append('overwrite', 'true');
    const response = await this.#fetch(`${this.#endpoint}/upload/image`, {
      method: 'POST', body: form,
    });
    const body = await parseJson(response, 'upload image');
    const name = stringField(body, 'name', 'upload image');
    const subfolder = optionalStringField(body, 'subfolder', 'upload image');
    return subfolder ? `${subfolder}/${name}` : name;
  }

  async submitPrompt(graph: ComfyGraph, clientId = this.createClientId()): Promise<string> {
    const response = await this.#fetch(`${this.#endpoint}/prompt`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: clientId }),
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

  async findTaskByClientId(clientId: string): Promise<string | null> {
    const queue = await this.#fetch(`${this.#endpoint}/queue`);
    const queueBody = queue.ok ? await queue.json() as unknown : null;
    const queued = findPromptInQueue(queueBody, clientId);
    if (queued) return queued;
    const history = await this.#fetch(`${this.#endpoint}/history`);
    const historyBody = history.ok ? await history.json() as unknown : null;
    return findPromptInHistory(historyBody, clientId);
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

  async cancelTask(promptId: string): Promise<void> {
    const state = await this.#fetch(`${this.#endpoint}/queue`);
    if (!state.ok) throw await httpError(state, 'inspect queue');
    const body = await state.json() as unknown;
    if (queueListContains(body, 'queue_pending', promptId)) {
      const deleted = await this.#fetch(`${this.#endpoint}/queue`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ delete: [promptId] }),
      });
      if (!deleted.ok) throw await httpError(deleted, 'delete queued prompt');
    }
    if (queueListContains(body, 'queue_running', promptId)) {
      const interrupt = await this.#fetch(`${this.#endpoint}/interrupt`,
        { method: 'POST' });
      if (!interrupt.ok) throw await httpError(interrupt, 'interrupt prompt');
    }
  }

  firstOutput(history: ComfyHistoryEntry): ComfyOutputItem {
    for (const output of Object.values(history.outputs ?? {})) {
      for (const key of ['gifs', 'videos', 'images']) {
        const items = output[key];
        if (Array.isArray(items) && items.length > 0 && isOutputItem(items[0])) {
          return items[0];
        }
      }
    }
    throw new H3ComfyError('H3_COMFY_OUTPUT_MISSING',
      'ComfyUI outputs contain no downloadable media');
  }

  viewUrl(item: ComfyOutputItem): string {
    const query = new URLSearchParams({ filename: item.filename,
      subfolder: item.subfolder ?? '', type: item.type ?? 'output' });
    return `${this.#endpoint}/view?${query.toString()}`;
  }

  async downloadOutput(item: ComfyOutputItem): Promise<Uint8Array> {
    const response = await this.#fetch(this.viewUrl(item));
    if (!response.ok) throw await httpError(response, 'download output');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) throw new H3ComfyError(
      'H3_COMFY_EMPTY_DOWNLOAD', 'Downloaded ComfyUI output is empty', {
        filename: item.filename,
      });
    return bytes;
  }

  async free(): Promise<void> {
    const response = await this.#fetch(`${this.#endpoint}/free`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    });
    if (!response.ok) throw await httpError(response, 'free memory');
  }
}

async function parseJson(response: Response, operation: string): Promise<Record<string, unknown>> {
  if (!response.ok) throw await httpError(response, operation);
  try {
    const body = await response.json() as unknown;
    if (!isRecord(body)) throw new Error('JSON root is not an object');
    return body;
  } catch (error) {
    throw new H3ComfyError('H3_COMFY_PROTOCOL_ERROR',
      `ComfyUI ${operation} returned invalid JSON`, {}, { cause: error });
  }
}

async function httpError(response: Response, operation: string) {
  const text = (await response.text()).slice(0, 800);
  return new H3ComfyError('H3_COMFY_HTTP_ERROR',
    `ComfyUI ${operation} failed with HTTP ${response.status}`, {
      status: response.status, response: text,
    });
}

function stringField(body: Record<string, unknown>, field: string, operation: string) {
  const value = body[field];
  if (typeof value !== 'string' || value.length === 0) throw new H3ComfyError(
    'H3_COMFY_PROTOCOL_ERROR', `ComfyUI ${operation} omitted ${field}`);
  return value;
}

function optionalStringField(body: Record<string, unknown>, field: string,
  operation: string) {
  const value = body[field];
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new H3ComfyError(
    'H3_COMFY_PROTOCOL_ERROR', `ComfyUI ${operation} returned invalid ${field}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOutputItem(value: unknown): value is ComfyOutputItem {
  return isRecord(value) && typeof value.filename === 'string';
}

function requestSignal(signal?: AbortSignal): RequestInit | undefined {
  return signal ? { signal } : undefined;
}

function delay(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) throw new H3ComfyError('H3_COMFY_ABORTED',
    'ComfyUI polling was aborted');
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new H3ComfyError('H3_COMFY_ABORTED',
        'ComfyUI polling was aborted'));
    }, { once: true });
  });
}

function queueContainsPrompt(value: unknown, promptId: string): boolean {
  if (!isRecord(value)) return false;
  return ['queue_running', 'queue_pending'].some((key) =>
    Array.isArray(value[key]) && (value[key] as unknown[]).some((item) =>
      Array.isArray(item) && item[1] === promptId));
}

function queueListContains(value: unknown, key: string, promptId: string): boolean {
  return isRecord(value) && Array.isArray(value[key]) &&
    (value[key] as unknown[]).some((item) => Array.isArray(item) && item[1] === promptId);
}

function queueHasEntries(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ['queue_running', 'queue_pending'].some((key) =>
    Array.isArray(value[key]) && value[key].length > 0);
}

function findPromptInQueue(value: unknown, clientId: string): string | null {
  if (!isRecord(value)) return null;
  for (const key of ['queue_running', 'queue_pending']) {
    const entries = value[key];
    if (!Array.isArray(entries)) continue;
    for (const item of entries) if (Array.isArray(item) &&
      isRecord(item[3]) && item[3].client_id === clientId &&
      typeof item[1] === 'string') return item[1];
  }
  return null;
}

function findPromptInHistory(value: unknown, clientId: string): string | null {
  if (!isRecord(value)) return null;
  for (const [promptId, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    const prompt = entry.prompt;
    if (Array.isArray(prompt) && isRecord(prompt[3]) &&
      prompt[3].client_id === clientId) return promptId;
    if (entry.client_id === clientId) return promptId;
  }
  return null;
}
