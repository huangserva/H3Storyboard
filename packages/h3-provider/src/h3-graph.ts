import { H3ComfyError, type ComfyGraph } from './comfyui-types.js';

const H3_UNET_I2V = 'minimax_h3_fl2va_pruned_int8_convrot.safetensors';
const H3_CLIP = 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors';
const H3_VIDEO_VAE = 'minimax_h3_video_vae_fp16.safetensors';
const H3_AUDIO_VAE = 'minimax_h3_audio_vae_fp32.safetensors';
const H3_TURBO = 'minimax_h3_turbo_v4_step600_ema_pruned_comfyui.safetensors';
const I2V_TASK = 'i2v — 图生视频(Image to Video)';

export interface H3Lora {
  name: string;
  strength: number;
}

export interface BuildH3I2VGraphInput {
  start_name: string;
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

export interface H3PromptWarning {
  code: 'H3_PROMPT_DIALOGUE_QUOTES';
  level: 'warning';
  line: number;
  message: string;
}

export function framesForDuration(seconds: number, fps = 24): number {
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(fps) || fps <= 0) {
    throw new H3ComfyError('H3_FRAME_GRID_INVALID',
      'Duration and fps must be positive finite numbers');
  }
  const target = Math.round(seconds * fps);
  return Math.max(5, 5 + Math.round((target - 5) / 17) * 17);
}

export function lintH3Prompt(prompt: string): H3PromptWarning[] {
  const warnings: H3PromptWarning[] = [];
  prompt.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*Audio\s*:/i.test(line) && hasCjk(line)) {
      throw new H3ComfyError('H3_PROMPT_CN_AUDIO',
        'Audio lines must not contain CJK text because H3 may speak the instruction',
        { line: index + 1 });
    }
    if (/^\s*(?:Dialogue|台词)\s*:/i.test(line) && hasCjk(line) &&
      !/「[^」]+」/.test(line)) {
      warnings.push({ code: 'H3_PROMPT_DIALOGUE_QUOTES', level: 'warning',
        line: index + 1, message: 'Chinese dialogue should be enclosed in 「」' });
    }
  });
  return warnings;
}

export function buildH3I2VGraph(input: BuildH3I2VGraphInput): ComfyGraph {
  validateGraphInput(input);
  lintH3Prompt(input.prompt);
  const fps = input.fps ?? 24;
  const timeline = buildTimeline(input, fps);
  const graph: ComfyGraph = {
    '1': { class_type: 'UNETLoader', inputs: {
      unet_name: H3_UNET_I2V, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: {
      clip_name: H3_CLIP, type: 'minimax', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: H3_VIDEO_VAE } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: H3_AUDIO_VAE } },
    '8': { class_type: 'LoadImage', inputs: { image: input.start_name } },
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
    task_type: I2V_TASK, global_prompt: input.prompt, bd_grp_sample: '采样设置',
    cfg: 1, seed: input.seed, frame_rate: fps, width: input.width,
    height: input.height, ref_max_size: Math.max(input.width, input.height),
    total_frames: input.frames, timeline_data: JSON.stringify(timeline),
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

function validateGraphInput(input: BuildH3I2VGraphInput): void {
  if (![input.width, input.height].every((value) =>
    Number.isInteger(value) && value > 0 && value % 32 === 0)) {
    throw new H3ComfyError('H3_DIMENSION_INVALID',
      'H3 width and height must be positive integers divisible by 32', {
        width: input.width, height: input.height,
      });
  }
  if (!Number.isInteger(input.frames) || input.frames < 5 ||
    (input.frames - 5) % 17 !== 0) {
    throw new H3ComfyError('H3_FRAME_GRID_INVALID',
      'H3 frame count must lie on the 17k+5 grid', { frames: input.frames });
  }
  if (!Number.isInteger(input.steps) || input.steps <= 0) {
    throw new H3ComfyError('H3_COMFY_PROTOCOL_ERROR',
      'Sampling steps must be a positive integer', { steps: input.steps });
  }
}

function buildTimeline(input: BuildH3I2VGraphInput, fps: number) {
  const duration = input.frames / fps;
  const image = { imageFile: input.start_name, width: input.width,
    height: input.height };
  return {
    version: 4, editMode: 'global', timelineMode: 'i2v',
    totalFrames: input.frames, frameRate: fps, width: input.width,
    height: input.height, refMaxSize: Math.max(input.width, input.height),
    output: { mode: 'fixed', longEdge: Math.max(input.width, input.height),
      width: input.width, height: input.height, maxExportFrames: 0,
      exportMode: 'all', continuityEnabled: false, continuityOverlapFrames: 9 },
    videoClips: [], video: { fileName: '', videoFile: '', subfolder: '',
      type: 'input', frames: [], frameMap: [] },
    global: { taskType: I2V_TASK, prompt: input.prompt, refs: [],
      referenceVideo: {}, continuousReference: false, genImage: image },
    shots: [{ id: 's0', durationSec: duration, prompt: input.prompt,
      startImage: image }],
    segments: [{ id: 's0', start: 0, length: input.frames,
      frameCount: input.frames, durationSec: duration, prompt: input.prompt,
      taskType: I2V_TASK, refs: [], referenceVideo: {}, genImage: image,
      negativePrompt: '' }],
    gen: { defaultFrameCount: input.frames }, runSelectEnabled: false,
    runSelection: [],
  };
}

function hasCjk(value: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(value);
}
