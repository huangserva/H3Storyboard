/**
 * The only place H3Storyboard obtains an H3 prompt (ADR 0003).
 *
 * A ShotPlan carries a structured `h3_prompt_spec`; the h3-film-studio skill
 * compiles it into MiniMax's official prompt format. Any client-supplied
 * `prompt` on a job is replaced by the compiled text, and the skill revision is
 * persisted with the job so every take can be traced to its rule set.
 */
import type { H3Mode, ShotPlan } from '@h3storyboard/protocol';
import { FilmStudioError, compilePrompt,
  type FilmStudioPromptSpec } from '@h3storyboard/film-studio-bridge';
import { ApiError } from './api-error.js';

export interface CompiledShotPrompt {
  prompt: string;
  film_studio_revision: string;
}

const FRAMES_PER_SECOND = 24;

const taskByMode: Partial<Record<H3Mode, FilmStudioPromptSpec['task']>> = {
  i2v: 'i2va',
  fl2v: 'fl2va',
  r2v: 'ref2va',
};

/**
 * Modes the local worker can run and the skill can compile. t2v/v2v/rv2v jobs
 * are contract-only here (the worker refuses them), so their prompt is left
 * untouched and `film_studio_revision` stays null.
 */
export function isCompilableMode(mode: H3Mode): boolean {
  return taskByMode[mode] !== undefined;
}

export function promptSpecFromShot(shot: ShotPlan,
  mode: H3Mode, referencePictures = 0): FilmStudioPromptSpec {
  if (!shot.h3_prompt_spec) throw new ApiError(422, 'H3_PROMPT_SPEC_REQUIRED',
    '镜头缺少结构化 H3 提示词（h3_prompt_spec）；提示词只能由 h3-film-studio 编译，不能手写',
    { shot_plan_id: shot.id });
  const task = taskByMode[mode];
  if (!task) throw new ApiError(422, 'FILM_STUDIO_TASK_UNSUPPORTED',
    `h3-film-studio 编译器暂不支持 ${mode} 的官方提示词格式`,
    { shot_plan_id: shot.id, mode });
  const spec = shot.h3_prompt_spec;
  // Full-reference mode: every uploaded reference picture defines one
  // <Subject N>; when the plan does not describe them, each subject is the
  // character shown in its picture with identity fully preserved.
  const subjects = task !== 'ref2va' ? [] : spec.subjects.length > 0
    ? spec.subjects
    : Array.from({ length: Math.max(referencePictures, 1) }, (_, index) => ({
      picture: index + 1,
      description: `the character shown in <Picture ${index + 1}>, whose face, hairstyle, and clothing are kept exactly as pictured`,
    }));
  return { task, frames: Math.round(shot.duration_seconds * FRAMES_PER_SECOND),
    subjects,
    style: spec.style, anchor: spec.anchor, beats: spec.beats,
    soundscape: spec.soundscape, lines: spec.lines,
    silent_subjects: spec.silent_subjects, camera: spec.camera,
    music: spec.music };
}

export async function compileShotPrompt(shot: ShotPlan,
  mode: H3Mode, referencePictures = 0): Promise<CompiledShotPrompt> {
  const spec = promptSpecFromShot(shot, mode, referencePictures);
  try {
    const compiled = await compilePrompt(spec);
    return { prompt: compiled.prompt,
      film_studio_revision: compiled.film_studio_revision };
  } catch (error) {
    if (error instanceof FilmStudioError) {
      const status = error.code === 'FILM_STUDIO_COMPILER_REJECTED' ? 422 : 503;
      throw new ApiError(status, error.code, error.message,
        { shot_plan_id: shot.id });
    }
    throw error;
  }
}

/** Maps compiler/bridge codes to director-facing Chinese messages. */
export const promptCompilationMessages: Readonly<Record<string, string>> = {
  H3_PROMPT_SPEC_REQUIRED: '请先在计划镜头里填写结构化 H3 提示词（画面锚定、动作、声景、台词）',
  FILM_STUDIO_COMPILER_REJECTED: '提示词不符合官方格式：台词以外不能出现中文，请检查画面与动作描述',
  FILM_STUDIO_TASK_UNSUPPORTED: '编译器暂不支持该生成方式的官方提示词格式',
  FILM_STUDIO_NOT_FOUND: '本机未找到 h3-film-studio，无法编译提示词（设置 H3_FILM_STUDIO_DIR）',
  FILM_STUDIO_PYTHON_FAILED: '本机无法运行 h3-film-studio 编译器（需要 python3）',
  FILM_STUDIO_PROTOCOL_ERROR: 'h3-film-studio 编译器返回了无法解析的结果',
};
