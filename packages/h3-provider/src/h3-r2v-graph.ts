import { H3ComfyError, type ComfyGraph } from './comfyui-types.js';
import { lintH3Prompt, type H3Lora } from './h3-graph.js';

const H3_UNET_FL2V = 'minimax_h3_fl2va_pruned_int8_convrot.safetensors';
const H3_UNET_R2V = 'minimax_h3_ref2va_pruned_int8_convrot.safetensors';
const H3_CLIP = 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors';
const H3_VIDEO_VAE = 'minimax_h3_video_vae_fp16.safetensors';
const H3_AUDIO_VAE = 'minimax_h3_audio_vae_fp32.safetensors';
const H3_TURBO = 'minimax_h3_turbo_v4_step600_ema_pruned_comfyui.safetensors';

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
  validateInput(input);
  lintH3Prompt(input.prompt);
  const graph: ComfyGraph = {
    '1': loaderNode(input.loader),
    '2': { class_type: 'CLIPLoader', inputs: {
      clip_name: H3_CLIP, type: 'minimax', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: H3_VIDEO_VAE } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: H3_AUDIO_VAE } },
  };
  const referenceInputs: Record<string, unknown> = {};
  input.reference_names.forEach((name, index) => {
    const id = String(8 + index);
    graph[id] = { class_type: 'LoadImage', inputs: { image: name } };
    referenceInputs[`ref_images.ref_image_${index}`] = [id, 0];
  });
  let model: [string, number] = ['1', 0];
  const loras = [...input.loras];
  if (input.turbo && !loras.some(({ name }) => name === H3_TURBO)) {
    loras.push({ name: H3_TURBO, strength: 1 });
  }
  loras.forEach((lora, index) => {
    const id = String(20 + index);
    graph[id] = { class_type: 'LoraLoaderModelOnly', inputs: {
      model, lora_name: lora.name, strength_model: lora.strength } };
    model = [id, 0];
  });
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
  const videoInputs: Record<string, unknown> = {
    images: ['36', 0], fps: input.fps ?? 24, bit_depth: 8,
  };
  if (input.generate_audio) {
    graph['37'] = { class_type: 'VAEDecodeAudio', inputs: {
      samples: ['35', 0], vae: ['4', 0] } };
    videoInputs.audio = ['37', 0];
  }
  graph['6'] = { class_type: 'CreateVideo', inputs: videoInputs };
  graph['7'] = { class_type: 'SaveVideo', inputs: {
    video: ['6', 0], filename_prefix: input.filename_prefix,
    format: 'auto', codec: 'auto',
  } };
  return graph;
}

function loaderNode(loader: H3R2VLoader) {
  if (loader.kind === 'stock') return { class_type: 'UNETLoader', inputs: {
    unet_name: H3_UNET_R2V, weight_dtype: 'default',
  } };
  return { class_type: 'MiniMaxH3HybridLoader', inputs: {
    base_model: H3_UNET_FL2V, overlay_model: H3_UNET_R2V,
    overlay_preset: 'block_range_adaln',
    block_range_start: loader.block_range_start,
    block_range_end: loader.block_range_end,
    final_adaln_from_overlay: false, custom_overlays: '', custom_base: '',
    weight_dtype: 'default',
  } };
}

function validateInput(input: BuildH3R2VGraphInput): void {
  if (![input.width, input.height].every((value) =>
    Number.isInteger(value) && value > 0 && value % 32 === 0)) {
    throw new H3ComfyError('H3_DIMENSION_INVALID',
      'H3 width and height must be positive integers divisible by 32');
  }
  if (!Number.isInteger(input.frames) || input.frames < 5 ||
    (input.frames - 5) % 17 !== 0) {
    throw new H3ComfyError('H3_FRAME_GRID_INVALID',
      'H3 frame count must lie on the 17k+5 grid');
  }
  if (input.reference_names.length < 1 || input.reference_names.length > 9 ||
    input.reference_names.some((name) => name.trim().length === 0)) {
    throw new H3ComfyError('H3_COMFY_PROTOCOL_ERROR',
      'H3 r2v requires between one and nine named image references');
  }
  if (!Number.isInteger(input.steps) || input.steps <= 0) {
    throw new H3ComfyError('H3_COMFY_PROTOCOL_ERROR',
      'Sampling steps must be a positive integer');
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
