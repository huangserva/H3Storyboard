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

  async submitPrompt(graph: ComfyGraph): Promise<string> {
    const response = await this.#fetch(`${this.#endpoint}/prompt`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: this.#clientIdFactory() }),
    });
    const body = await parseJson(response, 'submit prompt');
    if (isRecord(body.node_errors) && Object.keys(body.node_errors).length > 0) {
      throw new H3ComfyError('H3_COMFY_PROTOCOL_ERROR',
        'ComfyUI rejected graph nodes', { node_errors: body.node_errors });
    }
    return stringField(body, 'prompt_id', 'submit prompt');
  }

  async pollHistory(promptId: string): Promise<ComfyHistoryEntry> {
    for (let attempt = 0; attempt < this.#pollMaxAttempts; attempt += 1) {
      await delay(this.#pollIntervalMs);
      const response = await this.#fetch(
        `${this.#endpoint}/history/${encodeURIComponent(promptId)}`);
      if (!response.ok) continue;
      const body = await response.json() as unknown;
      if (!isRecord(body) || !isRecord(body[promptId])) continue;
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
        prompt_id: promptId, max_attempts: this.#pollMaxAttempts,
      });
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

function delay(milliseconds: number) {
  return milliseconds > 0
    ? new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}
