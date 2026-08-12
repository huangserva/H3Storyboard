import { H3ComfyError, type ComfyGraph } from './comfyui-types.js';
import type { H3Lora } from './h3-graph.js';

export const H3_MODELS = {
  fl2v: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
  r2v: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
  clip: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
  video_vae: 'minimax_h3_video_vae_fp16.safetensors',
  audio_vae: 'minimax_h3_audio_vae_fp32.safetensors',
  turbo: 'minimax_h3_turbo_v4_step600_ema_pruned_comfyui.safetensors',
} as const;

export interface H3GraphBaseInput {
  prompt: string; width: number; height: number; frames: number; fps?: number;
  seed: number; loras: readonly H3Lora[]; steps: number; turbo: boolean;
  filename_prefix: string; generate_audio: boolean;
}

export function validateH3GraphInput(input: H3GraphBaseInput): void {
  if (![input.width, input.height].every((value) => Number.isInteger(value) &&
    value > 0 && value % 32 === 0)) throw new H3ComfyError(
      'H3_DIMENSION_INVALID', 'H3 dimensions must be divisible by 32');
  if (!Number.isInteger(input.frames) || input.frames < 5 ||
    (input.frames - 5) % 17 !== 0) throw new H3ComfyError(
      'H3_FRAME_GRID_INVALID', 'H3 frame count must lie on the 17k+5 grid');
  if (!Number.isInteger(input.steps) || input.steps <= 0) throw new H3ComfyError(
    'H3_COMFY_PROTOCOL_ERROR', 'Sampling steps must be a positive integer');
}

export function baseGraph(loader: ComfyGraph[string]): ComfyGraph {
  return { '1': loader,
    '2': { class_type: 'CLIPLoader', inputs: {
      clip_name: H3_MODELS.clip, type: 'minimax', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: H3_MODELS.video_vae } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: H3_MODELS.audio_vae } } };
}

export function appendLoras(graph: ComfyGraph, input: H3GraphBaseInput,
  startId: number): [string, number] {
  let model: [string, number] = ['1', 0];
  const loras = [...input.loras];
  if (input.turbo && !loras.some(({ name }) => name === H3_MODELS.turbo)) {
    loras.push({ name: H3_MODELS.turbo, strength: 1 });
  }
  loras.forEach((lora, index) => {
    const id = String(startId + index);
    graph[id] = { class_type: 'LoraLoaderModelOnly', inputs: {
      model, lora_name: lora.name, strength_model: lora.strength } };
    model = [id, 0];
  });
  return model;
}

export function appendVideoOutput(graph: ComfyGraph, image: [string, number],
  audio: [string, number] | null, fps: number | [string, number],
  input: Pick<H3GraphBaseInput, 'filename_prefix'>): void {
  graph['6'] = { class_type: 'CreateVideo', inputs: {
    images: image, fps, bit_depth: 8, ...(audio ? { audio } : {}) } };
  graph['7'] = { class_type: 'SaveVideo', inputs: { video: ['6', 0],
    filename_prefix: input.filename_prefix, format: 'auto', codec: 'auto' } };
}

export function graphNodeTypes(graph: ComfyGraph): readonly string[] {
  return [...new Set(Object.values(graph).map(({ class_type }) => class_type))];
}
