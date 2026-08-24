import { H3ComfyError, type ComfyGraph } from './comfyui-types.js';

interface CharacterImageGraphBaseInput {
  prompt: string;
  seed: number;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  filename_prefix: string;
}

export interface CharacterImageLora {
  name: string;
  strength: number;
}

export interface KreaMasterGraphInput extends CharacterImageGraphBaseInput {
  lora: CharacterImageLora | null;
}

export interface KreaVariantGraphInput extends KreaMasterGraphInput {
  source_image: string;
  denoise: number;
}

export interface QwenIdentityGraphInput extends CharacterImageGraphBaseInput {
  source_images: readonly string[];
  denoise: number;
}

const KREA_MODELS = {
  unet: 'krea2_turbo_fp8.safetensors',
  clip: 'qwen3vl_4b_fp8_scaled.safetensors',
  vae: 'qwen_image_vae.safetensors',
} as const;

const QWEN_MODELS = {
  unet: 'qwen_image_edit_2511_fp8_lightning_4steps.safetensors',
  clip: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
  vae: 'qwen_image_vae.safetensors',
} as const;

export function buildKreaMasterGraph(input: KreaMasterGraphInput): ComfyGraph {
  validateBase(input);
  const graph = kreaBase(input);
  graph.latent = { class_type: 'EmptyLatentImage', inputs: {
    width: input.width, height: input.height, batch_size: 1,
  } };
  graph.sampler = kreaSampler(input, ['latent', 0], 1,
    appendOptionalLora(graph, input.lora));
  appendImageOutput(graph, ['sampler', 0], input.filename_prefix);
  return graph;
}

export function buildKreaVariantGraph(input: KreaVariantGraphInput): ComfyGraph {
  validateBase(input);
  validateDenoise(input.denoise);
  requireText(input.source_image, 'Krea variant source image');
  const graph = kreaBase(input);
  graph.source = { class_type: 'LoadImage', inputs: { image: input.source_image } };
  graph.encode = { class_type: 'VAEEncode', inputs: {
    pixels: ['source', 0], vae: ['vae', 0],
  } };
  graph.sampler = kreaSampler(input, ['encode', 0], input.denoise,
    appendOptionalLora(graph, input.lora));
  appendImageOutput(graph, ['sampler', 0], input.filename_prefix);
  return graph;
}

export function buildQwenIdentityGraph(input: QwenIdentityGraphInput): ComfyGraph {
  validateBase(input);
  validateDenoise(input.denoise);
  if (input.source_images.length < 1 || input.source_images.length > 3) {
    throw new H3ComfyError('H3_COMFY_PROTOCOL_ERROR',
      'Qwen identity edit requires one to three reference images');
  }
  input.source_images.forEach((source) =>
    requireText(source, 'Qwen identity source image'));
  const graph: ComfyGraph = {
    unet: { class_type: 'UNETLoader', inputs: {
      unet_name: QWEN_MODELS.unet, weight_dtype: 'default',
    } },
    clip: { class_type: 'CLIPLoader', inputs: {
      clip_name: QWEN_MODELS.clip, type: 'qwen_image', device: 'default',
    } },
    vae: { class_type: 'VAELoader', inputs: { vae_name: QWEN_MODELS.vae } },
    sampling: { class_type: 'ModelSamplingAuraFlow', inputs: {
      model: ['unet', 0], shift: 3.1,
    } },
    cfg_norm: { class_type: 'CFGNorm', inputs: {
      model: ['sampling', 0], strength: 1, pre_cfg: false,
    } },
    image1: { class_type: 'LoadImage', inputs: {
      image: input.source_images[0],
    } },
    scaled_image1: { class_type: 'FluxKontextImageScale', inputs: {
      image: ['image1', 0],
    } },
  };
  const positive: Record<string, unknown> = {
    clip: ['clip', 0], vae: ['vae', 0], image1: ['scaled_image1', 0],
    prompt: input.prompt,
  };
  const negative: Record<string, unknown> = {
    clip: ['clip', 0], vae: ['vae', 0], image1: ['scaled_image1', 0], prompt: '',
  };
  if (input.source_images[1]) {
    graph.image2 = { class_type: 'LoadImage', inputs: {
      image: input.source_images[1],
    } };
    positive.image2 = ['image2', 0];
    negative.image2 = ['image2', 0];
  }
  if (input.source_images[2]) {
    graph.image3 = { class_type: 'LoadImage', inputs: {
      image: input.source_images[2],
    } };
    positive.image3 = ['image3', 0];
    negative.image3 = ['image3', 0];
  }
  graph.positive = { class_type: 'TextEncodeQwenImageEditPlus',
    inputs: positive };
  graph.negative = { class_type: 'TextEncodeQwenImageEditPlus',
    inputs: negative };
  graph.positive_refs = { class_type: 'FluxKontextMultiReferenceLatentMethod',
    inputs: { conditioning: ['positive', 0],
      reference_latents_method: 'index_timestep_zero' } };
  graph.negative_refs = { class_type: 'FluxKontextMultiReferenceLatentMethod',
    inputs: { conditioning: ['negative', 0],
      reference_latents_method: 'index_timestep_zero' } };
  graph.encode = { class_type: 'VAEEncode', inputs: {
    pixels: ['scaled_image1', 0], vae: ['vae', 0],
  } };
  graph.sampler = { class_type: 'KSampler', inputs: {
    model: ['cfg_norm', 0], positive: ['positive_refs', 0],
    negative: ['negative_refs', 0], latent_image: ['encode', 0],
    seed: input.seed, steps: input.steps, cfg: input.cfg,
    sampler_name: input.sampler, scheduler: input.scheduler,
    denoise: input.denoise,
  } };
  appendImageOutput(graph, ['sampler', 0], input.filename_prefix);
  return graph;
}

function kreaBase(input: CharacterImageGraphBaseInput): ComfyGraph {
  return {
    unet: { class_type: 'UNETLoader', inputs: {
      unet_name: KREA_MODELS.unet, weight_dtype: 'default',
    } },
    clip: { class_type: 'CLIPLoader', inputs: {
      clip_name: KREA_MODELS.clip, type: 'krea2', device: 'default',
    } },
    vae: { class_type: 'VAELoader', inputs: { vae_name: KREA_MODELS.vae } },
    positive: { class_type: 'CLIPTextEncode', inputs: {
      text: input.prompt, clip: ['clip', 0],
    } },
    negative: { class_type: 'ConditioningZeroOut', inputs: {
      conditioning: ['positive', 0],
    } },
  };
}

function appendOptionalLora(graph: ComfyGraph,
  lora: CharacterImageLora | null): [string, number] {
  if (!lora) return ['unet', 0];
  requireText(lora.name, 'Krea LoRA name');
  if (!Number.isFinite(lora.strength) || lora.strength < -2 ||
    lora.strength > 2) throw new H3ComfyError('H3_COMFY_PROTOCOL_ERROR',
    'Krea LoRA strength must be between -2 and 2');
  graph.lora = { class_type: 'LoraLoaderModelOnly', inputs: {
    model: ['unet', 0], lora_name: lora.name, strength_model: lora.strength,
  } };
  return ['lora', 0];
}

function kreaSampler(input: CharacterImageGraphBaseInput,
  latentImage: [string, number], denoise: number,
  model: [string, number]): ComfyGraph[string] {
  return { class_type: 'KSampler', inputs: {
    model, seed: input.seed, steps: input.steps, cfg: input.cfg,
    sampler_name: input.sampler, scheduler: input.scheduler,
    positive: ['positive', 0], negative: ['negative', 0],
    latent_image: latentImage, denoise,
  } };
}

function appendImageOutput(graph: ComfyGraph, samples: [string, number],
  filenamePrefix: string): void {
  graph.decode = { class_type: 'VAEDecode', inputs: {
    samples, vae: ['vae', 0],
  } };
  graph.save = { class_type: 'SaveImage', inputs: {
    images: ['decode', 0], filename_prefix: filenamePrefix,
  } };
}

function validateBase(input: CharacterImageGraphBaseInput): void {
  requireText(input.prompt, 'Character image prompt');
  requireText(input.filename_prefix, 'Character image filename prefix');
  requireText(input.sampler, 'Character image sampler');
  requireText(input.scheduler, 'Character image scheduler');
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) throw new H3ComfyError(
    'H3_COMFY_PROTOCOL_ERROR', 'Character image seed must be a non-negative integer');
  if (![input.width, input.height].every((value) => Number.isInteger(value) &&
    value >= 64 && value <= 4_096)) throw new H3ComfyError(
      'H3_DIMENSION_INVALID', 'Character image dimensions must be 64..4096 pixels');
  if (!Number.isInteger(input.steps) || input.steps < 1 || input.steps > 100) {
    throw new H3ComfyError('H3_COMFY_PROTOCOL_ERROR',
      'Character image steps must be an integer from 1 to 100');
  }
  if (!Number.isFinite(input.cfg) || input.cfg <= 0 || input.cfg > 100) {
    throw new H3ComfyError('H3_COMFY_PROTOCOL_ERROR',
      'Character image CFG must be greater than 0 and at most 100');
  }
}

function validateDenoise(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new H3ComfyError('H3_COMFY_PROTOCOL_ERROR',
      'Character image denoise must be between 0 and 1');
  }
}

function requireText(value: string, label: string): void {
  if (!value.trim()) throw new H3ComfyError('H3_COMFY_PROTOCOL_ERROR',
    `${label} must not be empty`);
}
