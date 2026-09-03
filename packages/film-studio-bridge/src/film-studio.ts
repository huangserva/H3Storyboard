/**
 * Bridge to the h3-film-studio skill (github.com/huangserva/h3-film-studio).
 *
 * h3-film-studio is a COMPONENT of H3Storyboard: every H3 production rule, the
 * official-format prompt compiler, and the continuity preflight gate live there,
 * in exactly one place. This package only locates the skill and invokes it.
 * Never re-implement a rule here. See docs/adr/0003-h3-film-studio-as-component.md.
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type FilmStudioErrorCode =
  | 'FILM_STUDIO_NOT_FOUND'
  | 'FILM_STUDIO_PYTHON_FAILED'
  | 'FILM_STUDIO_COMPILER_REJECTED'
  | 'FILM_STUDIO_PROTOCOL_ERROR';

export class FilmStudioError extends Error {
  constructor(
    readonly code: FilmStudioErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'FilmStudioError';
  }
}

export const FILM_STUDIO_DIR_ENV = 'H3_FILM_STUDIO_DIR';
export const DEFAULT_FILM_STUDIO_DIR = join(
  homedir(),
  '.claude',
  'skills',
  'h3-film-studio',
);

const COMPILER = join('scripts', 'h3_prompt_compiler.py');
const PREFLIGHT = join('scripts', 'preflight_continuity.py');

export function resolveFilmStudioDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const dir = env[FILM_STUDIO_DIR_ENV] ?? DEFAULT_FILM_STUDIO_DIR;
  if (!existsSync(join(dir, COMPILER))) {
    throw new FilmStudioError(
      'FILM_STUDIO_NOT_FOUND',
      `h3-film-studio not found at ${dir} (set ${FILM_STUDIO_DIR_ENV}); expected ${COMPILER}`,
    );
  }
  return dir;
}

/** One spoken line. Text stays in its original language and goes verbatim into <d>. */
export interface FilmStudioLine {
  speaker: string;
  who: string;
  verb: string;
  text: string;
  lang?: string;
  after?: string;
}

/** One reference picture that defines a <Subject N> in full-reference mode. */
export interface FilmStudioSubject {
  picture: number;
  description: string;
}

export interface FilmStudioPromptSpec {
  task: 'i2va' | 'fl2va' | 'ref2va';
  /** required for ref2va: one entry per reference picture */
  subjects?: FilmStudioSubject[];
  frames: number;
  style: string;
  anchor: string;
  beats: string[];
  soundscape: string;
  lines?: FilmStudioLine[];
  silent_subjects?: string[];
  camera?: string;
  music?: string;
}

export interface CompiledPrompt {
  task: 'i2va' | 'fl2va' | 'ref2va';
  prompt: string;
  /** characters per second of dialogue; 0 for silent shots */
  density: number;
  /** git revision of the skill that produced this prompt, for provenance */
  film_studio_revision: string;
}

export interface PreflightResult {
  ok: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
  film_studio_revision: string;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runPython(
  dir: string,
  script: string,
  args: string[],
  input?: string,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [join(dir, script), ...args], { cwd: dir });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      reject(
        new FilmStudioError(
          'FILM_STUDIO_PYTHON_FAILED',
          `could not run python3 ${script}: ${error.message}`,
          { cause: error },
        ),
      );
    });
    child.on('close', (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
    // execFile cannot feed stdin; the compiler reads its spec from stdin, so
    // write it and close the pipe explicitly.
    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

export async function filmStudioRevision(dir: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: dir,
    });
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

/** Compile an official-format H3 prompt through the skill's compiler. */
export async function compilePrompt(
  spec: FilmStudioPromptSpec,
  dir: string = resolveFilmStudioDir(),
): Promise<CompiledPrompt> {
  const run = await runPython(dir, COMPILER, ['--json'], JSON.stringify(spec));
  let parsed: unknown;
  try {
    parsed = JSON.parse(run.stdout);
  } catch (error) {
    throw new FilmStudioError(
      'FILM_STUDIO_PROTOCOL_ERROR',
      `compiler returned non-JSON (exit ${run.code}): ${run.stderr || run.stdout}`,
      { cause: error },
    );
  }
  if (run.code !== 0) {
    const err = parsed as { error?: string; message?: string };
    throw new FilmStudioError(
      'FILM_STUDIO_COMPILER_REJECTED',
      `${err.error ?? 'REJECTED'}: ${err.message ?? run.stderr}`,
    );
  }
  const out = parsed as {
    task: 'i2va' | 'fl2va' | 'ref2va';
    prompt: string;
    density: number;
  };
  return { ...out, film_studio_revision: await filmStudioRevision(dir) };
}

/** Run the continuity/pose state-machine gate on a shot_table.json. */
export async function runPreflight(
  shotTablePath: string,
  dir: string = resolveFilmStudioDir(),
): Promise<PreflightResult> {
  const run = await runPython(dir, PREFLIGHT, [
    '--table',
    shotTablePath,
    '--strict-pose-change',
  ]);
  return {
    ok: run.code === 0,
    exit_code: run.code,
    stdout: run.stdout,
    stderr: run.stderr,
    film_studio_revision: await filmStudioRevision(dir),
  };
}
