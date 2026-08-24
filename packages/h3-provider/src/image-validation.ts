import sharp from 'sharp';

const MAX_IMAGE_PIXELS = 40_000_000;
const mimeByFormat = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const;

export interface DecodedCharacterImage {
  mime_type: typeof mimeByFormat[keyof typeof mimeByFormat];
  width: number;
  height: number;
  channels: number;
  pixel_bytes: number;
}

export class CharacterImageValidationError extends Error {
  readonly code = 'CHARACTER_IMAGE_INVALID';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CharacterImageValidationError';
  }
}

export async function decodeCharacterImage(
  bytes: Uint8Array,
): Promise<DecodedCharacterImage> {
  if (bytes.byteLength === 0) throw new CharacterImageValidationError(
    'Character image is empty');
  try {
    const options = { failOn: 'error' as const, limitInputPixels: MAX_IMAGE_PIXELS,
      pages: 1 };
    const metadata = await sharp(bytes, options).metadata();
    const format = metadata.format as keyof typeof mimeByFormat | undefined;
    if (!format || !mimeByFormat[format]) throw new CharacterImageValidationError(
      'Character image must decode as PNG, JPEG, or WebP');
    if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) {
      throw new CharacterImageValidationError(
        'Character image must contain exactly one non-empty frame');
    }
    const { data, info } = await sharp(bytes, options).raw().toBuffer({
      resolveWithObject: true,
    });
    if (info.width !== metadata.width || info.height !== metadata.height ||
      data.byteLength !== info.width * info.height * info.channels) {
      throw new CharacterImageValidationError(
        'Character image pixel decode was incomplete');
    }
    return { mime_type: mimeByFormat[format], width: info.width,
      height: info.height, channels: info.channels, pixel_bytes: data.byteLength };
  } catch (error) {
    if (error instanceof CharacterImageValidationError) throw error;
    throw new CharacterImageValidationError(
      'Character image could not be fully decoded', { cause: error });
  }
}
