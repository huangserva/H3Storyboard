import { H3ComfyError, type ComfyHistoryEntry,
  type ComfyOutputItem } from './comfyui-types.js';

export async function parseJson(response: Response,
  operation: string): Promise<Record<string, unknown>> {
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

export async function httpError(response: Response, operation: string) {
  const responseText = (await response.text()).slice(0, 800);
  return new H3ComfyError('H3_COMFY_HTTP_ERROR',
    `ComfyUI ${operation} failed with HTTP ${response.status}`, {
      status: response.status, response: responseText,
    });
}

export function stringField(body: Record<string, unknown>, field: string,
  operation: string) {
  const value = body[field];
  if (typeof value !== 'string' || value.length === 0) throw new H3ComfyError(
    'H3_COMFY_PROTOCOL_ERROR', `ComfyUI ${operation} omitted ${field}`);
  return value;
}

export function optionalStringField(body: Record<string, unknown>, field: string,
  operation: string) {
  const value = body[field];
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new H3ComfyError(
    'H3_COMFY_PROTOCOL_ERROR', `ComfyUI ${operation} returned invalid ${field}`);
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isOutputItem(value: unknown): value is ComfyOutputItem {
  return isRecord(value) && typeof value.filename === 'string';
}

export function firstOutput(history: ComfyHistoryEntry): ComfyOutputItem {
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

export function firstImageOutput(history: ComfyHistoryEntry): ComfyOutputItem {
  for (const output of Object.values(history.outputs ?? {})) {
    const items = output.images;
    if (Array.isArray(items) && items.length > 0 && isOutputItem(items[0])) {
      return items[0];
    }
  }
  throw new H3ComfyError('H3_COMFY_OUTPUT_MISSING',
    'ComfyUI outputs contain no downloadable image');
}

export function requestSignal(signal?: AbortSignal): RequestInit | undefined {
  return signal ? { signal } : undefined;
}

export function delay(milliseconds: number, signal?: AbortSignal) {
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

export function queueContainsPrompt(value: unknown, promptId: string): boolean {
  return queuePromptIds(value).includes(promptId);
}

export function queueListContains(value: unknown, key: string,
  promptId: string): boolean {
  return isRecord(value) && Array.isArray(value[key]) &&
    (value[key] as unknown[]).some((item) =>
      Array.isArray(item) && item[1] === promptId);
}

export function queueHasEntries(value: unknown): boolean {
  return queuePromptIds(value).length > 0;
}

export function queuePromptIds(value: unknown): string[] {
  if (!isRecord(value)) throw invalidQueue();
  return ['queue_running', 'queue_pending'].flatMap((key) => {
    const entries = value[key];
    if (!Array.isArray(entries)) throw invalidQueue();
    return entries.map((item) => {
      if (!Array.isArray(item) || typeof item[1] !== 'string') {
        throw invalidQueue();
      }
      return item[1];
    });
  });
}

function invalidQueue(): H3ComfyError {
  return new H3ComfyError('H3_COMFY_PROTOCOL_ERROR',
    'ComfyUI queue response is malformed');
}

export function findPromptInQueue(value: unknown,
  clientId: string): string | null {
  queuePromptIds(value);
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

export function findPromptInHistory(value: unknown,
  clientId: string): string | null {
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

export async function findTaskByClientId(endpoint: string, clientId: string,
  fetchFn: typeof globalThis.fetch, pollIntervalMs: number,
  signal?: AbortSignal, confirmationAttempts = 1): Promise<string | null> {
  for (let attempt = 0; attempt < confirmationAttempts; attempt += 1) {
    const queue = await fetchFn(`${endpoint}/queue`, requestSignal(signal));
    if (!queue.ok) throw await httpError(queue, 'recover task by client id');
    const queued = findPromptInQueue(await queue.json() as unknown, clientId);
    if (queued) return queued;
    const history = await fetchFn(`${endpoint}/history`, requestSignal(signal));
    if (!history.ok) throw await httpError(history, 'recover task by client id');
    const recovered = findPromptInHistory(
      await history.json() as unknown, clientId);
    if (recovered) return recovered;
    if (attempt + 1 < confirmationAttempts) await delay(pollIntervalMs, signal);
  }
  return null;
}
