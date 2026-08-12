import { H3ComfyError, type ComfyGraph } from './comfyui-types.js';
import { lintH3Prompt, type H3Lora } from './h3-graph.js';

const H3_UNET_FL2V = 'minimax_h3_fl2va_pruned_int8_convrot.safetensors';
const H3_CLIP = 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors';
const H3_VIDEO_VAE = 'minimax_h3_video_vae_fp16.safetensors';
const H3_AUDIO_VAE = 'minimax_h3_audio_vae_fp32.safetensors';
const H3_TURBO = 'minimax_h3_turbo_v4_step600_ema_pruned_comfyui.safetensors';
const FL2V_TASK = 'fl2v — 首尾帧生视频(First-Last Frame)';

export interface BuildH3FL2VGraphInput {
  start_name: string;
  end_name: string;
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
}

export function buildH3FL2VGraph(input: BuildH3FL2VGraphInput): ComfyGraph {
  validateInput(input);
  lintH3Prompt(input.prompt);
  const fps = input.fps ?? 24;
  const graph: ComfyGraph = {
    '1': { class_type: 'UNETLoader', inputs: {
      unet_name: H3_UNET_FL2V, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: {
      clip_name: H3_CLIP, type: 'minimax', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: H3_VIDEO_VAE } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: H3_AUDIO_VAE } },
  };
  let model: [string, number] = ['1', 0];
  const loras = [...input.loras];
  if (input.turbo && !loras.some(({ name }) => name === H3_TURBO)) {
    loras.push({ name: H3_TURBO, strength: 1 });
  }
  loras.forEach((lora, index) => {
    const id = String(10 + index);
    graph[id] = { class_type: 'LoraLoaderModelOnly', inputs: {
      model, lora_name: lora.name, strength_model: lora.strength } };
    model = [id, 0];
  });
  graph['5'] = { class_type: 'MiniMaxH3Director', inputs: {
    model, video_vae: ['3', 0], audio_vae: ['4', 0], clip: ['2', 0],
    task_type: FL2V_TASK, global_prompt: input.prompt,
    bd_grp_sample: '采样设置', cfg: 1, seed: input.seed, frame_rate: fps,
    width: input.width, height: input.height,
    ref_max_size: Math.max(input.width, input.height),
    total_frames: input.frames,
    timeline_data: JSON.stringify(buildTimeline(input, fps)),
    bd_grp_advanced: '高级采样 Advanced', steps: input.steps,
    sampler: 'res_multistep', scheduler: 'simple', shift_video: 12,
    shift_audio: 3, bd_grp_perf: '性能 Performance',
    clear_vram_between_segments: true, export_source_images: false,
  } };
  const videoInputs: Record<string, unknown> = {
    images: ['5', 0], fps: ['5', 2], bit_depth: 8,
  };
  if (input.generate_audio) videoInputs.audio = ['5', 1];
  graph['6'] = { class_type: 'CreateVideo', inputs: videoInputs };
  graph['7'] = { class_type: 'SaveVideo', inputs: {
    video: ['6', 0], filename_prefix: input.filename_prefix,
    format: 'auto', codec: 'auto',
  } };
  return graph;
}

function validateInput(input: BuildH3FL2VGraphInput): void {
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
  if (!input.start_name.trim() || !input.end_name.trim()) {
    throw new H3ComfyError('H3_COMFY_PROTOCOL_ERROR',
      'H3 fl2v requires named first and last frame images');
  }
  if (!Number.isInteger(input.steps) || input.steps <= 0) {
    throw new H3ComfyError('H3_COMFY_PROTOCOL_ERROR',
      'Sampling steps must be a positive integer');
  }
}

function buildTimeline(input: BuildH3FL2VGraphInput, fps: number) {
  const duration = input.frames / fps;
  const startImage = { imageFile: input.start_name, width: input.width,
    height: input.height };
  const endImage = { imageFile: input.end_name, width: input.width,
    height: input.height };
  return {
    version: 4, editMode: 'global', timelineMode: 'fl2v',
    totalFrames: input.frames, frameRate: fps, width: input.width,
    height: input.height, refMaxSize: Math.max(input.width, input.height),
    output: { mode: 'fixed', longEdge: Math.max(input.width, input.height),
      width: input.width, height: input.height, maxExportFrames: 0,
      exportMode: 'all', continuityEnabled: false, continuityOverlapFrames: 9 },
    videoClips: [], video: { fileName: '', videoFile: '', subfolder: '',
      type: 'input', frames: [], frameMap: [] },
    global: { taskType: FL2V_TASK, prompt: input.prompt, refs: [],
      referenceVideo: {}, continuousReference: false, genImage: startImage },
    shots: [{ id: 's0', durationSec: duration, prompt: input.prompt,
      startImage, endImage }],
    segments: [{ id: 's0', start: 0, length: input.frames,
      frameCount: input.frames, durationSec: duration, prompt: input.prompt,
      taskType: FL2V_TASK, refs: [], referenceVideo: {}, genImage: startImage,
      endImage, negativePrompt: '' }],
    gen: { defaultFrameCount: input.frames }, runSelectEnabled: false,
    runSelection: [],
  };
}
