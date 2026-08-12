import { describe, expect, it } from 'vitest';
import {
  H3ComfyError,
  buildH3I2VGraph,
  buildH3R2VGraph,
  framesForDuration,
  lintH3Prompt,
} from '../../packages/h3-provider/src/index.js';

const base = {
  start_name: 'inputs/start.png',
  prompt: 'A woman walks through the rain.',
  width: 480,
  height: 864,
  frames: 124,
  fps: 24,
  seed: 20260811,
  loras: [{ name: 'H3_Motion_Booster.safetensors', strength: 0.7 }],
  steps: 20,
  turbo: true,
  filename_prefix: 'h3storyboard/shot-1',
  generate_audio: true,
} as const;

const r2vBase = {
  reference_names: ['inputs/scene.png', 'inputs/lin-lan.png'],
  prompt: '<Picture 1> establishes the rainy alley. <Picture 2> is Lin Lan.',
  width: 480,
  height: 864,
  frames: 124,
  fps: 24,
  seed: 20260812,
  loras: [] as const,
  steps: 4,
  turbo: true,
  filename_prefix: 'h3storyboard/r2v-shot-1',
  generate_audio: true,
} as const;

describe('H3 i2v graph contract', () => {
  it('builds the proven Director graph with deterministic LoRA wiring', () => {
    const graph = buildH3I2VGraph(base);

    expect(Object.fromEntries(Object.entries(graph).map(([id, node]) =>
      [id, node.class_type]))).toMatchInlineSnapshot(`
      {
        "1": "UNETLoader",
        "10": "LoraLoaderModelOnly",
        "11": "LoraLoaderModelOnly",
        "2": "CLIPLoader",
        "3": "VAELoader",
        "4": "VAELoader",
        "5": "MiniMaxH3Director",
        "6": "CreateVideo",
        "7": "SaveVideo",
        "8": "LoadImage",
      }
    `);
    expect(graph['10']?.inputs.model).toEqual(['1', 0]);
    expect(graph['11']?.inputs.model).toEqual(['10', 0]);
    expect(graph['5']?.inputs.model).toEqual(['11', 0]);
    expect(graph['5']?.inputs.seed).toBe(20260811);
    expect(graph['5']?.inputs.total_frames).toBe(124);
    expect(graph['6']?.inputs.audio).toEqual(['5', 1]);
    expect(JSON.parse(String(graph['5']?.inputs.timeline_data))).toMatchObject({
      totalFrames: 124,
      global: { genImage: { imageFile: 'inputs/start.png' } },
    });
  });

  it('omits audio wiring and turbo LoRA when disabled', () => {
    const graph = buildH3I2VGraph({ ...base, turbo: false,
      generate_audio: false, loras: [] });
    expect(graph['6']?.inputs).not.toHaveProperty('audio');
    expect(graph['5']?.inputs.model).toEqual(['1', 0]);
  });

  it.each([[481, 864], [480, 850]])(
    'rejects dimensions outside the 32-pixel grid', (width, height) => {
      expect(() => buildH3I2VGraph({ ...base, width, height })).toThrowError(
        expect.objectContaining({ code: 'H3_DIMENSION_INVALID' }));
    });

  it('rejects frames outside the 17k+5 grid', () => {
    expect(() => buildH3I2VGraph({ ...base, frames: 123 })).toThrowError(
      expect.objectContaining({ code: 'H3_FRAME_GRID_INVALID' }));
  });

  it('converts duration to the nearest 24fps H3 frame grid point', () => {
    expect(framesForDuration(5)).toBe(124);
    expect(framesForDuration(15)).toBe(362);
  });
});

describe('H3 prompt lint', () => {
  it('blocks CJK content on Audio lines with a stable code', () => {
    expect(() => lintH3Prompt('Camera: close-up\nAudio: 全程无人声')).toThrowError(
      expect.objectContaining<H3ComfyError>({ code: 'H3_PROMPT_CN_AUDIO' }));
  });

  it('warns rather than blocks unbracketed Chinese dialogue', () => {
    expect(lintH3Prompt('Dialogue: 林澜说你来了。')).toEqual([{
      code: 'H3_PROMPT_DIALOGUE_QUOTES',
      level: 'warning',
      line: 1,
      message: expect.stringContaining('「」'),
    }]);
    expect(lintH3Prompt('Dialogue: 林澜说「你来了。」')).toEqual([]);
  });
});

describe('H3 r2v graph contract', () => {
  it('builds ordered multi-reference inputs with the stock ref2va loader', () => {
    const graph = buildH3R2VGraph({ ...r2vBase,
      loader: { kind: 'stock' } });

    expect(Object.fromEntries(Object.entries(graph).map(([id, node]) =>
      [id, node.class_type]))).toMatchInlineSnapshot(`
      {
        "1": "UNETLoader",
        "2": "CLIPLoader",
        "20": "LoraLoaderModelOnly",
        "3": "VAELoader",
        "30": "MiniMaxH3SigmaShift",
        "31": "RandomNoise",
        "32": "BasicGuider",
        "33": "KSamplerSelect",
        "34": "BasicScheduler",
        "35": "SamplerCustomAdvanced",
        "36": "VAEDecode",
        "37": "VAEDecodeAudio",
        "4": "VAELoader",
        "5": "MiniMaxH3ReferenceToVideo",
        "6": "CreateVideo",
        "7": "SaveVideo",
        "8": "LoadImage",
        "9": "LoadImage",
      }
    `);
    expect(graph['1']?.inputs).toEqual({
      unet_name: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
      weight_dtype: 'default',
    });
    expect(graph['5']?.inputs['ref_images.ref_image_0']).toEqual(['8', 0]);
    expect(graph['5']?.inputs['ref_images.ref_image_1']).toEqual(['9', 0]);
    expect(graph['8']?.inputs.image).toBe('inputs/scene.png');
    expect(graph['9']?.inputs.image).toBe('inputs/lin-lan.png');
  });

  it('changes only the loader contract for the recommended hybrid', () => {
    const graph = buildH3R2VGraph({ ...r2vBase, loader: {
      kind: 'hybrid', block_range_start: 30, block_range_end: 49,
    } });

    expect(graph['1']).toEqual({
      class_type: 'MiniMaxH3HybridLoader',
      inputs: {
        base_model: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
        overlay_model: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
        overlay_preset: 'block_range_adaln',
        block_range_start: 30,
        block_range_end: 49,
        final_adaln_from_overlay: false,
        custom_overlays: '',
        custom_base: '',
        weight_dtype: 'default',
      },
    });
    expect(graph['5']?.class_type).toBe('MiniMaxH3ReferenceToVideo');
    expect(graph['5']?.inputs['ref_images.ref_image_1']).toEqual(['9', 0]);
  });

  it('rejects an empty reference list', () => {
    expect(() => buildH3R2VGraph({ ...r2vBase, reference_names: [],
      loader: { kind: 'stock' } })).toThrowError(expect.objectContaining({
        code: 'H3_COMFY_PROTOCOL_ERROR',
      }));
  });
});
