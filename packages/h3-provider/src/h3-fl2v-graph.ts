import { H3ComfyError, type ComfyGraph } from './comfyui-types.js';
import { lintH3Prompt, type H3Lora } from './h3-graph.js';
import { appendLoras, appendVideoOutput, baseGraph, graphNodeTypes, H3_MODELS,
  validateH3GraphInput } from './h3-graph-common.js';

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
  validateH3GraphInput(input);
  if (!input.start_name.trim() || !input.end_name.trim()) throw new H3ComfyError(
    'H3_COMFY_PROTOCOL_ERROR', 'H3 fl2v requires named first and last frame images');
  lintH3Prompt(input.prompt);
  const fps = input.fps ?? 24;
  const graph = baseGraph({ class_type: 'UNETLoader', inputs: {
    unet_name: H3_MODELS.fl2v, weight_dtype: 'default' } });
  const model = appendLoras(graph, input, 10);
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
  appendVideoOutput(graph, ['5', 0], input.generate_audio ? ['5', 1] : null,
    ['5', 2], input);
  return graph;
}

export const H3_FL2V_NODE_TYPES = graphNodeTypes(buildH3FL2VGraph({
  start_name: 'first.png', end_name: 'last.png', prompt: '', width: 480,
  height: 864, frames: 124, seed: 0, loras: [], steps: 4, turbo: true,
  filename_prefix: 'capability/fl2v', generate_audio: true,
}));

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
