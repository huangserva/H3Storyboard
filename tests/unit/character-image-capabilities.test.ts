import { describe, expect, test, vi } from 'vitest';
import { buildQwenIdentityGraph, discoverGraphCapabilities } from
  '../../packages/h3-provider/src/index.js';

describe('character image capability discovery', () => {
  test('checks exactly the nodes required by the selected image graph', async () => {
    const graph = buildQwenIdentityGraph({ prompt: 'identity edit', seed: 7,
      width: 480, height: 864, steps: 4, cfg: 1, sampler: 'euler',
      scheduler: 'simple', filename_prefix: 'character/test', denoise: 1,
      source_images: ['master.png'] });
    const nodeTypes = [...new Set(Object.values(graph).map(
      ({ class_type }) => class_type))];
    const missing = 'TextEncodeQwenImageEditPlus';
    const fetchFn = vi.fn<typeof fetch>(async () => Response.json(
      Object.fromEntries(nodeTypes.filter((node) => node !== missing)
        .map((node) => [node, {}]))));

    const evidence = await discoverGraphCapabilities(
      'http://krea.test/', graph, fetchFn);

    expect(evidence.endpoint).toBe('http://krea.test');
    expect(evidence.ready).toBe(false);
    expect(evidence.nodes[missing]).toBe('missing');
    expect(fetchFn).toHaveBeenCalledOnce();
  });
});
