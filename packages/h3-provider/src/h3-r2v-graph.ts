import { H3ComfyError, type ComfyGraph } from './comfyui-types.js';
import { lintH3Prompt, type H3Lora } from './h3-graph.js';
import { appendLoras, appendVideoOutput, baseGraph, graphNodeTypes, H3_MODELS,
  validateH3GraphInput } from './h3-graph-common.js';


export type H3R2VLoader =
  | { kind: 'stock' }
  | { kind: 'hybrid'; block_range_start: number; block_range_end: number };

export interface BuildH3R2VGraphInput {
  reference_names: readonly string[];
  prompt: string;
  width: number;
  height: number;
  frames: number;
  fps?: number;
  seed: number;
  loras: readonly H3Lora[];
  steps: number;
  turbo: boolean;
  filename_prefix: string;
  generate_audio: boolean;
  loader: H3R2VLoader;
}

export function buildH3R2VGraph(input: BuildH3R2VGraphInput): ComfyGraph {
  validateH3GraphInput(input);
  validateReferences(input);
  lintH3Prompt(input.prompt);
  const graph = baseGraph(loaderNode(input.loader));
  const referenceInputs: Record<string, unknown> = {};
  input.reference_names.forEach((name, index) => {
    const id = String(8 + index);
    graph[id] = { class_type: 'LoadImage', inputs: { image: name } };
    referenceInputs[`ref_images.ref_image_${index}`] = [id, 0];
  });
  const model = appendLoras(graph, input, 20);
  graph['30'] = { class_type: 'MiniMaxH3SigmaShift', inputs: {
    model, shift_video: 12, shift_audio: 3 } };
  const sampledModel: [string, number] = ['30', 0];
  graph['5'] = { class_type: 'MiniMaxH3ReferenceToVideo', inputs: {
    clip: ['2', 0], vae: ['3', 0], audio_vae: ['4', 0],
    prompt: input.prompt, width: input.width, height: input.height,
    length: input.frames, ref_image_size: 'match', ...referenceInputs,
  } };
  graph['31'] = { class_type: 'RandomNoise', inputs: { noise_seed: input.seed } };
  graph['32'] = { class_type: 'BasicGuider', inputs: {
    model: sampledModel, conditioning: ['5', 0] } };
  graph['33'] = { class_type: 'KSamplerSelect', inputs: {
    sampler_name: 'res_multistep' } };
  graph['34'] = { class_type: 'BasicScheduler', inputs: {
    model: sampledModel, scheduler: 'simple', steps: input.steps, denoise: 1 } };
  graph['35'] = { class_type: 'SamplerCustomAdvanced', inputs: {
    noise: ['31', 0], guider: ['32', 0], sampler: ['33', 0],
    sigmas: ['34', 0], latent_image: ['5', 1],
  } };
  graph['36'] = { class_type: 'VAEDecode', inputs: {
    samples: ['35', 0], vae: ['3', 0] } };
  let audio: [string, number] | null = null;
  if (input.generate_audio) {
    graph['37'] = { class_type: 'VAEDecodeAudio', inputs: {
      samples: ['35', 0], vae: ['4', 0] } };
    audio = ['37', 0];
  }
  appendVideoOutput(graph, ['36', 0], audio, input.fps ?? 24, input);
  return graph;
}

function loaderNode(loader: H3R2VLoader) {
  if (loader.kind === 'stock') return { class_type: 'UNETLoader', inputs: {
    unet_name: H3_MODELS.r2v, weight_dtype: 'default',
  } };
  return { class_type: 'MiniMaxH3HybridLoader', inputs: {
    base_model: H3_MODELS.fl2v, overlay_model: H3_MODELS.r2v,
    overlay_preset: 'block_range_adaln',
    block_range_start: loader.block_range_start,
    block_range_end: loader.block_range_end,
    final_adaln_from_overlay: false, custom_overlays: '', custom_base: '',
    weight_dtype: 'default',
  } };
}

function validateReferences(input: BuildH3R2VGraphInput): void {
  if (input.reference_names.length < 1 || input.reference_names.length > 9 ||
    input.reference_names.some((name) => name.trim().length === 0)) {
    throw new H3ComfyError('H3_COMFY_PROTOCOL_ERROR',
      'H3 r2v requires between one and nine named image references');
  }
  if (input.loader.kind === 'hybrid' &&
    (!Number.isInteger(input.loader.block_range_start) ||
      !Number.isInteger(input.loader.block_range_end) ||
      input.loader.block_range_start < 0 || input.loader.block_range_end > 49 ||
      input.loader.block_range_start > input.loader.block_range_end)) {
    throw new H3ComfyError('H3_COMFY_PROTOCOL_ERROR',
      'Hybrid block range must be an ordered subset of 0..49');
  }
}

const capabilityR2VInput = {
  reference_names: ['reference.png'], prompt: '', width: 480, height: 864,
  frames: 124, seed: 0, loras: [], steps: 4, turbo: true,
  filename_prefix: 'capability/r2v', generate_audio: true,
} as const;
export const H3_R2V_NODE_TYPES = [...new Set([
  ...graphNodeTypes(buildH3R2VGraph({ ...capabilityR2VInput,
    loader: { kind: 'stock' } })),
  ...graphNodeTypes(buildH3R2VGraph({ ...capabilityR2VInput,
    loader: { kind: 'hybrid', block_range_start: 30, block_range_end: 49 } })),
])];
