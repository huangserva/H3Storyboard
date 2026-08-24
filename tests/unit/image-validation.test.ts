import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { decodeCharacterImage } from '../../packages/h3-provider/src/index.js';

describe('character image pixel validation', () => {
  test('fully decodes a real JPEG and reports canonical metadata', async () => {
    const bytes = await readFile(new URL(
      '../fixtures/canvas-demo/su-wanning.jpg', import.meta.url));
    const decoded = await decodeCharacterImage(bytes);

    expect(decoded).toMatchObject({ mime_type: 'image/jpeg', width: 240,
      height: 432 });
    expect(decoded.pixel_bytes).toBe(240 * 432 * decoded.channels);
  });

  test('rejects a structurally plausible but truncated JPEG', async () => {
    const bytes = await readFile(new URL(
      '../fixtures/canvas-demo/su-wanning.jpg', import.meta.url));
    const truncated = Buffer.concat([bytes.subarray(0, 256),
      Buffer.from([0xff, 0xd9])]);

    await expect(decodeCharacterImage(truncated)).rejects.toMatchObject({
      code: 'CHARACTER_IMAGE_INVALID',
    });
  });

  test('rejects animated or oversized image canvases before persistence', async () => {
    const oversizedHeaderOnly = Buffer.from(
      '89504e470d0a1a0a0000000d494844520000300000003000080600000000000000',
      'hex');
    await expect(decodeCharacterImage(oversizedHeaderOnly)).rejects.toMatchObject({
      code: 'CHARACTER_IMAGE_INVALID',
    });
  });
});
