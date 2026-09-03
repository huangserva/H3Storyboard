import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILM_STUDIO_DIR,
  FilmStudioError,
  compilePrompt,
  resolveFilmStudioDir,
} from '@h3storyboard/film-studio-bridge';

const skillPresent = existsSync(
  join(
    process.env.H3_FILM_STUDIO_DIR ?? DEFAULT_FILM_STUDIO_DIR,
    'scripts',
    'h3_prompt_compiler.py',
  ),
);

const I2VA_HEAD =
  'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.';
const FL2VA_HEAD_8S =
  'How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the 8.00-second mark of the target video.';

describe('film-studio bridge', () => {
  it('reports a stable error code when the skill is missing', () => {
    let caught: unknown;
    try {
      resolveFilmStudioDir({ H3_FILM_STUDIO_DIR: '/nonexistent/h3-film-studio' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FilmStudioError);
    expect((caught as FilmStudioError).code).toBe('FILM_STUDIO_NOT_FOUND');
  });

  describe.skipIf(!skillPresent)('with the real skill checkout', () => {
    it('compiles an official-format I2VA prompt with <d> dialogue and speaker id', async () => {
      const out = await compilePrompt({
        task: 'i2va',
        frames: 124,
        style: 'Live-action, cinematic',
        anchor:
          'a close-up frames the young woman in a white robe shown in <Picture 1> in a candlelit bedchamber',
        beats: ['She lifts her gaze from the silver ingot, alarmed'],
        soundscape:
          'Quiet indoor room tone with a faint candle flicker continues throughout.',
        lines: [
          {
            speaker: 'S1',
            who: 'The young woman with a soft, trembling voice',
            verb: 'asks',
            text: '官人这话是什么意思，妾身实在听不明白。',
          },
        ],
      });
      expect(out.task).toBe('i2va');
      expect(out.prompt.startsWith(I2VA_HEAD)).toBe(true);
      expect(out.prompt).toContain('integrated_multimodal_description: [Shot 1]');
      expect(out.prompt).toContain(
        '(S1) asks: <d>[Chinese] 官人这话是什么意思，妾身实在听不明白。</d>',
      );
      expect(out.prompt).toContain('overall_soundscape:');
      expect(out.prompt).toContain('non_diegetic_music: N/A');
      expect(out.density).toBeGreaterThan(1.5);
      expect(out.film_studio_revision).toMatch(/^[0-9a-f]{40}$|^unknown$/);
    });

    it('rejects Chinese outside <d> with FILM_STUDIO_COMPILER_REJECTED', async () => {
      await expect(
        compilePrompt({
          task: 'i2va',
          frames: 124,
          style: 'Live-action, cinematic',
          anchor: 'a close-up frames the woman shown in <Picture 1>',
          beats: ['她低头看着银锭'],
          soundscape: 'Quiet room tone.',
        }),
      ).rejects.toMatchObject({ code: 'FILM_STUDIO_COMPILER_REJECTED' });
    });

    it('writes the FL2VA alignment header from the frame count and the official closed-lips clause', async () => {
      const out = await compilePrompt({
        task: 'fl2va',
        frames: 192,
        style: 'Live-action, cinematic',
        anchor: 'the man and the woman shown in Picture 1',
        beats: ['He pulls her up by the wrist'],
        soundscape: 'Silk rustles and a chair scrapes on wood.',
        silent_subjects: ['The young woman'],
      });
      expect(out.prompt.startsWith(FL2VA_HEAD_8S)).toBe(true);
      expect(out.prompt).toContain('lips remain completely closed');
      expect(out.density).toBe(0);
    });
  });
});
