import { describe, expect, test } from 'vitest';
import {
  buildKreaMasterGraph,
  buildKreaVariantGraph,
  buildQwenIdentityGraph,
} from '../../packages/h3-provider/src/index.js';

const base = {
  prompt: 'cinematic character portrait, closed mouth, neutral expression',
  seed: 2026082401,
  width: 480,
  height: 864,
  filename_prefix: 'h3storyboard/character-job',
};

describe('character image ComfyUI graphs', () => {
  test('builds a generic Krea master without an implicit LoRA', () => {
    const graph = buildKreaMasterGraph({ ...base, steps: 8, cfg: 1,
      sampler: 'euler_ancestral', scheduler: 'sgm_uniform', lora: null });

    expect(Object.values(graph).some(({ class_type }) =>
      class_type === 'LoraLoaderModelOnly')).toBe(false);
    expect(graph.sampler?.inputs).toMatchObject({ model: ['unet', 0],
      seed: base.seed, steps: 8, denoise: 1 });
    expect(graph.latent?.inputs).toMatchObject({ width: 480, height: 864,
      batch_size: 1 });
  });

  test('persists an explicit Krea LoRA in the graph only when requested', () => {
    const graph = buildKreaMasterGraph({ ...base, steps: 8, cfg: 1,
      sampler: 'euler_ancestral', scheduler: 'sgm_uniform',
      lora: { name: 'approved-profile.safetensors', strength: 0.55 } });

    expect(graph.lora?.inputs).toMatchObject({ model: ['unet', 0],
      lora_name: 'approved-profile.safetensors', strength_model: 0.55 });
    expect(graph.sampler?.inputs.model).toEqual(['lora', 0]);
  });

  test('builds Krea variant i2i from the uploaded approved source', () => {
    const graph = buildKreaVariantGraph({ ...base, steps: 8, cfg: 1,
      sampler: 'euler_ancestral', scheduler: 'sgm_uniform', denoise: 0.42,
      source_image: 'h3storyboard/source-master.png', lora: null });

    expect(graph.source?.inputs.image).toBe('h3storyboard/source-master.png');
    expect(graph.encode?.inputs).toMatchObject({ pixels: ['source', 0],
      vae: ['vae', 0] });
    expect(graph.sampler?.inputs).toMatchObject({ latent_image: ['encode', 0],
      denoise: 0.42 });
  });

  test('builds Qwen identity edit with one to three uploaded references', () => {
    const one = buildQwenIdentityGraph({ ...base, steps: 4, cfg: 1,
      sampler: 'euler', scheduler: 'simple', denoise: 1,
      source_images: ['h3storyboard/master.png'] });
    expect(one.image1?.inputs.image).toBe('h3storyboard/master.png');
    expect(one.image2).toBeUndefined();
    expect(one.positive?.inputs.image1).toEqual(['scaled_image1', 0]);

    const two = buildQwenIdentityGraph({ ...base, steps: 4, cfg: 1,
      sampler: 'euler', scheduler: 'simple', denoise: 1,
      source_images: ['h3storyboard/master.png', 'h3storyboard/profile.png'] });
    expect(two.image2?.inputs.image).toBe('h3storyboard/profile.png');
    expect(two.positive?.inputs.image2).toEqual(['image2', 0]);
    expect(two.negative?.inputs.image2).toEqual(['image2', 0]);
    const three = buildQwenIdentityGraph({ ...base, steps: 4, cfg: 1,
      sampler: 'euler', scheduler: 'simple', denoise: 1,
      source_images: ['master.png', 'profile.png', 'costume.png'] });
    expect(three.image3?.inputs.image).toBe('costume.png');
    expect(three.positive?.inputs.image3).toEqual(['image3', 0]);
  });

  test('rejects unsupported Qwen reference counts before submission', () => {
    const input = { ...base, steps: 4, cfg: 1, sampler: 'euler',
      scheduler: 'simple', denoise: 1 };
    expect(() => buildQwenIdentityGraph({ ...input, source_images: [] }))
      .toThrowError(/one to three/i);
    expect(() => buildQwenIdentityGraph({ ...input,
      source_images: ['one.png', 'two.png', 'three.png', 'four.png'] }))
      .toThrowError(/one to three/i);
  });
});
