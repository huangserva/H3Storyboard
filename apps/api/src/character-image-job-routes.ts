import {
  CharacterImageJobSchema,
  CharacterImageOperationSchema,
  CreateCharacterImageJobInputSchema,
  IdSchema,
  RetryCharacterImageJobInputSchema,
  type CharacterImageJob,
} from '@h3storyboard/protocol';
import type { ProjectStore } from '@h3storyboard/project-store';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { ApiError, parseResponseContract } from './api-error.js';
import { readJson } from './http.js';

interface RouteResult { status: number; body: unknown }

export interface CharacterImageJobRouteOptions {
  readonly lora_allowlist: ReadonlySet<string>;
  readonly cancel_character_image_job?: (
    jobId: string,
    reason: string,
  ) => Promise<CharacterImageJob>;
}

const CREATE = /^\/api\/projects\/([^/]+)\/characters\/([^/]+)\/image_jobs$/;
const LIST = /^\/api\/projects\/([^/]+)\/character_image_jobs$/;
const RETRY = /^\/api\/projects\/([^/]+)\/character_image_jobs\/([^/]+)\/retry$/;
const CANCEL = /^\/api\/projects\/([^/]+)\/character_image_jobs\/([^/]+)\/cancel$/;

const CancelInputSchema = z.object({
  reason: z.string().trim().min(1).max(1_000),
});

export async function dispatchCharacterImageJobRoute(
  request: IncomingMessage,
  store: ProjectStore,
  method: string,
  pathname: string,
  options: CharacterImageJobRouteOptions,
): Promise<RouteResult | null> {
  const create = CREATE.exec(pathname);
  if (create && method === 'POST') {
    const projectId = decode(create[1] ?? '', 'project_id');
    const characterId = decode(create[2] ?? '', 'character_id');
    const input = parseCreateInput(await readJson(request));
    assertAllowedLora(input.lora_name, options.lora_allowlist);
    const job = store.characterImageJobs.create(projectId, characterId, input);
    return { status: 201,
      body: parseResponseContract(CharacterImageJobSchema, job) };
  }

  const list = LIST.exec(pathname);
  if (list && method === 'GET') {
    const projectId = decode(list[1] ?? '', 'project_id');
    const characterId = optionalCharacterId(request);
    const jobs = store.characterImageJobs.list(projectId, characterId);
    return { status: 200,
      body: parseResponseContract(CharacterImageJobSchema.array(), jobs) };
  }

  const retry = RETRY.exec(pathname);
  if (retry && method === 'POST') {
    const projectId = decode(retry[1] ?? '', 'project_id');
    const jobId = decode(retry[2] ?? '', 'job_id');
    const original = scopedJob(store, projectId, jobId);
    assertAllowedLora(original.lora_name, options.lora_allowlist);
    const parsed = RetryCharacterImageJobInputSchema.safeParse(
      await readJson(request));
    if (!parsed.success) throw invalidInput(
      'Character image retry input is invalid', parsed.error.issues);
    const job = store.characterImageJobs.retry(projectId, jobId, parsed.data);
    return { status: 201,
      body: parseResponseContract(CharacterImageJobSchema, job) };
  }

  const cancel = CANCEL.exec(pathname);
  if (cancel && method === 'POST') {
    const projectId = decode(cancel[1] ?? '', 'project_id');
    const jobId = decode(cancel[2] ?? '', 'job_id');
    const current = scopedJob(store, projectId, jobId);
    const parsed = CancelInputSchema.safeParse(await readJson(request));
    if (!parsed.success) throw invalidInput(
      'Character image cancel input is invalid', parsed.error.issues);
    if (!options.cancel_character_image_job && hasRemoteTask(current)) {
      throw new ApiError(503, 'CHARACTER_IMAGE_CANCEL_UNAVAILABLE',
        'The worker that owns this provider task is unavailable; cancellation was not recorded',
        { job_id: jobId, provider_job_id: current.provider_job_id });
    }
    const job = options.cancel_character_image_job
      ? await options.cancel_character_image_job(jobId, parsed.data.reason)
      : store.characterImageJobs.cancel(jobId, parsed.data.reason);
    return { status: 200,
      body: parseResponseContract(CharacterImageJobSchema, job) };
  }

  return null;
}

function hasRemoteTask(job: CharacterImageJob): boolean {
  return ['submitting', 'queued', 'running', 'timed_out'].includes(job.status) &&
    (job.provider_client_id !== null || job.provider_job_id !== null);
}

function parseCreateInput(value: unknown) {
  if (!isRecord(value)) throw invalidInput(
    'Character image job input must be an object');
  if ('engine' in value || 'provider' in value) throw invalidInput(
    'Character image engine and provider are selected by the server');
  const operation = CharacterImageOperationSchema.safeParse(value.operation);
  if (!operation.success) throw invalidInput(
    'Character image operation is invalid', operation.error.issues);
  const engine = operation.data === 'identity_edit'
    ? 'qwen_image_edit_2511' : 'krea2';
  const parsed = CreateCharacterImageJobInputSchema.safeParse({
    ...value,
    provider: 'local_comfyui',
    engine,
  });
  if (!parsed.success) throw invalidInput(
    'Character image job input is invalid', parsed.error.issues);
  return parsed.data;
}

function scopedJob(store: ProjectStore, projectId: string,
  jobId: string): CharacterImageJob {
  const job = store.characterImageJobs.get(jobId);
  if (job.project_id !== projectId) throw new ApiError(
    404,
    'CHARACTER_IMAGE_JOB_NOT_FOUND',
    'Character image job does not exist',
    { project_id: projectId, job_id: jobId },
  );
  return job;
}

function assertAllowedLora(loraName: string | null,
  allowlist: ReadonlySet<string>): void {
  if (loraName === null) return;
  if (!allowlist.has(loraName)) throw new ApiError(
    422,
    'CHARACTER_IMAGE_LORA_NOT_ALLOWED',
    'Character image LoRA is not allowed by this server',
    { lora_name: loraName },
  );
}

function optionalCharacterId(request: IncomingMessage): string | undefined {
  const value = new URL(request.url ?? '/', 'http://localhost')
    .searchParams.get('character_id');
  if (value === null) return undefined;
  const parsed = IdSchema.safeParse(value);
  if (!parsed.success) throw new ApiError(
    400,
    'ROUTE_PARAMETER_INVALID',
    'character_id is invalid',
  );
  return parsed.data;
}

function decode(value: string, name: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded) throw new Error('empty');
    return decoded;
  } catch {
    throw new ApiError(400, 'ROUTE_PARAMETER_INVALID', `${name} is invalid`);
  }
}

function invalidInput(message: string, details?: unknown): ApiError {
  return new ApiError(422, 'CHARACTER_IMAGE_INPUT_INVALID', message, details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
