import { H3ComfyError, type ComfyGraph } from './comfyui-types.js';
import { appendLoras, appendVideoOutput, baseGraph, graphNodeTypes, H3_MODELS,
  validateH3GraphInput } from './h3-graph-common.js';

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
  validateH3GraphInput(input);
  lintH3Prompt(input.prompt);
  const fps = input.fps ?? 24;
  const timeline = buildTimeline(input, fps);
  const graph = baseGraph({ class_type: 'UNETLoader', inputs: {
    unet_name: H3_MODELS.fl2v, weight_dtype: 'default' } });
  graph['8'] = { class_type: 'LoadImage', inputs: { image: input.start_name } };
  const model = appendLoras(graph, input, 10);
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
  appendVideoOutput(graph, ['5', 0], input.generate_audio ? ['5', 1] : null,
    ['5', 2], input);
  return graph;
}

export const H3_I2V_NODE_TYPES = graphNodeTypes(buildH3I2VGraph({
  start_name: 'capability.png', prompt: '', width: 480, height: 864,
  frames: 124, seed: 0, loras: [], steps: 4, turbo: true,
  filename_prefix: 'capability/i2v', generate_audio: true,
}));

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
