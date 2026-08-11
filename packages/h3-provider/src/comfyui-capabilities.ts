import { H3ComfyError } from './comfyui-types.js';

export const REQUIRED_H3_NODES = [
  'MiniMaxH3ImageToVideo',
  'MiniMaxH3ReferenceToVideo',
  'EmptyMiniMaxH3LatentAV',
  'MiniMaxH3Director',
  'UNETLoader',
  'CLIPLoader',
  'VAELoader',
  'LoraLoaderModelOnly',
  'LoadImage',
  'CreateVideo',
  'SaveVideo',
] as const;

export type H3RequiredNode = typeof REQUIRED_H3_NODES[number];

export interface H3CapabilityEvidence {
  endpoint: string;
  checked_at: string;
  ready: boolean;
  nodes: Record<H3RequiredNode, 'present' | 'missing'>;
}

export async function discoverCapabilities(endpoint: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch): Promise<H3CapabilityEvidence> {
  const normalized = endpoint.replace(/\/+$/, '');
  const response = await fetchFn(`${normalized}/object_info`);
  if (!response.ok) throw new H3ComfyError('H3_COMFY_HTTP_ERROR',
    `ComfyUI capability discovery failed with HTTP ${response.status}`, {
      status: response.status,
    });
  const body = await response.json() as unknown;
  if (!isRecord(body)) throw new H3ComfyError('H3_COMFY_PROTOCOL_ERROR',
    'ComfyUI object_info root must be an object');
  const nodes = Object.fromEntries(REQUIRED_H3_NODES.map((node) =>
    [node, isRecord(body[node]) ? 'present' : 'missing'])) as
    Record<H3RequiredNode, 'present' | 'missing'>;
  return { endpoint: normalized, checked_at: new Date().toISOString(),
    ready: Object.values(nodes).every((status) => status === 'present'), nodes };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
