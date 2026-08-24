import { H3ComfyError } from './comfyui-types.js';
import type { ComfyGraph } from './comfyui-types.js';
import { graphNodeTypes } from './h3-graph-common.js';
import { H3_I2V_NODE_TYPES } from './h3-graph.js';
import { H3_FL2V_NODE_TYPES } from './h3-fl2v-graph.js';
import { H3_R2V_NODE_TYPES } from './h3-r2v-graph.js';

export const REQUIRED_H3_NODES = [...new Set([
  ...H3_I2V_NODE_TYPES, ...H3_FL2V_NODE_TYPES, ...H3_R2V_NODE_TYPES,
])] as readonly string[];

export type H3RequiredNode = typeof REQUIRED_H3_NODES[number];

export interface H3CapabilityEvidence {
  endpoint: string;
  checked_at: string;
  ready: boolean;
  nodes: Record<H3RequiredNode, 'present' | 'missing'>;
}

export interface ComfyGraphCapabilityEvidence {
  endpoint: string;
  checked_at: string;
  ready: boolean;
  nodes: Record<string, 'present' | 'missing'>;
}

export async function discoverCapabilities(endpoint: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
  signal?: AbortSignal): Promise<H3CapabilityEvidence> {
  return discoverRequiredNodes(endpoint, REQUIRED_H3_NODES, fetchFn, signal) as
    Promise<H3CapabilityEvidence>;
}

export async function discoverGraphCapabilities(endpoint: string,
  graph: ComfyGraph,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
  signal?: AbortSignal,
): Promise<ComfyGraphCapabilityEvidence> {
  return discoverRequiredNodes(endpoint, graphNodeTypes(graph), fetchFn, signal);
}

async function discoverRequiredNodes(endpoint: string,
  requiredNodes: readonly string[], fetchFn: typeof globalThis.fetch,
  signal?: AbortSignal,
): Promise<ComfyGraphCapabilityEvidence> {
  const normalized = endpoint.replace(/\/+$/, '');
  const response = await fetchFn(`${normalized}/object_info`,
    signal ? { signal } : undefined);
  if (!response.ok) throw new H3ComfyError('H3_COMFY_HTTP_ERROR',
    `ComfyUI capability discovery failed with HTTP ${response.status}`, {
      status: response.status,
    });
  const body = await response.json() as unknown;
  if (!isRecord(body)) throw new H3ComfyError('H3_COMFY_PROTOCOL_ERROR',
    'ComfyUI object_info root must be an object');
  const nodes = Object.fromEntries(requiredNodes.map((node) =>
    [node, isRecord(body[node]) ? 'present' : 'missing'])) as
    Record<string, 'present' | 'missing'>;
  return { endpoint: normalized, checked_at: new Date().toISOString(),
    ready: Object.values(nodes).every((status) => status === 'present'), nodes };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
