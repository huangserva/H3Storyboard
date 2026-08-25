import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from
  'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { CanvasDemoError } from './canvas-demo-error.js';

export interface InstalledMedia {
  name: string;
  relative_path: string;
  content_hash: string;
  observed_description: string;
}

interface SourceMedia extends Omit<InstalledMedia, 'relative_path'> {
  bytes: Buffer;
}

export interface CanvasDemoMediaSource {
  woman_image: SourceMedia;
  man_image: SourceMedia;
  take_one: SourceMedia;
  take_one_tail: SourceMedia;
  take_two: SourceMedia;
}

export async function loadCanvasDemoMedia(
  fixtureDirectory: string,
): Promise<CanvasDemoMediaSource> {
  const load = async (sourceName: string, targetName: string,
    observedDescription: string): Promise<SourceMedia> => {
    const bytes = await readFile(join(fixtureDirectory, sourceName));
    if (targetName.endsWith('.mp4')) assertSilentMp4(targetName, bytes);
    return { name: targetName, bytes,
      content_hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      observed_description: observedDescription };
  };
  return {
    woman_image: await load('su-wanning.jpg', 'su-wanning.jpg',
      '苏婉宁身份参考图。'),
    man_image: await load('gu-chengyuan.jpg', 'gu-chengyuan.jpg',
      '顾承远身份参考图。'),
    take_one: await load('rain-night-take-01.mp4', 'take-01-silent.mp4',
      '两人在旅店门廊停步，人物身份、绿色旗袍与炭灰西装连续。'),
    take_one_tail: await load('rain-night-take-01-tail.png',
      'take-01-tail.png', '已批准 Take 01 的真实尾帧，用于连续性拖拽测试。'),
    take_two: await load('rain-night-take-02.mp4', 'take-02-silent.mp4',
      '替代 Take；人物服装保持一致，女主向前一步，等待导演 QC。'),
  };
}

export function installCanvasDemoMedia(projectId: string,
  dataDirectory: string, source: CanvasDemoMediaSource) {
  const canonicalRoot = realpathSync(dataDirectory);
  const install = (media: SourceMedia): InstalledMedia => {
    const relativePath = `projects/${projectId}/canvas-demo/${media.name}`;
    const targetPath = join(dataDirectory, relativePath);
    mkdirSync(dirname(targetPath), { recursive: true });
    const canonicalParent = realpathSync(dirname(targetPath));
    if (canonicalParent !== canonicalRoot &&
      !canonicalParent.startsWith(`${canonicalRoot}${sep}`)) {
      throw new CanvasDemoError('CANVAS_DEMO_MEDIA_PATH_INVALID',
        'Canvas demo media target escapes the data directory');
    }
    const canonicalTarget = join(canonicalParent, media.name);
    const temporaryPath = `${canonicalTarget}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, media.bytes, { flag: 'wx' });
      renameSync(temporaryPath, canonicalTarget);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
    return { name: media.name, relative_path: relativePath,
      content_hash: media.content_hash,
      observed_description: media.observed_description };
  };
  return {
    woman_image: install(source.woman_image),
    man_image: install(source.man_image),
    take_one: install(source.take_one),
    take_one_tail: install(source.take_one_tail),
    take_two: install(source.take_two),
  };
}

function assertSilentMp4(name: string, bytes: Buffer): void {
  let offset = 0;
  let videoTrack = false;
  while ((offset = bytes.indexOf('hdlr', offset, 'ascii')) >= 0) {
    const handler = bytes.toString('ascii', offset + 12, offset + 16);
    if (handler === 'soun') throw new CanvasDemoError(
      'CANVAS_DEMO_AUDIO_FORBIDDEN',
      `${name} contains a forbidden audio track`);
    if (handler === 'vide') videoTrack = true;
    offset += 4;
  }
  if (!videoTrack) throw new CanvasDemoError(
    'CANVAS_DEMO_VIDEO_TRACK_MISSING',
    `${name} does not contain an MP4 video track`);
}
