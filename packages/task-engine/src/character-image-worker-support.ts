import {
  buildKreaMasterGraph,
  buildKreaVariantGraph,
  buildQwenIdentityGraph,
  CharacterImageValidationError,
  decodeCharacterImage,
  H3ComfyError,
  type ComfyGraph,
} from '@h3storyboard/h3-provider';
import {
  RelativeAssetPathSchema,
  CharacterImageFailureCodeSchema,
  type Asset,
  type CharacterImageFailureCode,
  type CharacterImageJob,
  type CharacterImageJobEvent,
  type CharacterImageOutputResult,
  type FinalizeCharacterImageOutputInput,
} from '@h3storyboard/protocol';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve, sep } from 'node:path';
import type { ComfyUIClient } from '@h3storyboard/h3-provider';
import type { SharedGpuCoordinator } from './gpu-coordinator.js';

export interface CharacterImageJobStoreLike {
  recoverExpired(now?: Date): number;
  claim(jobId: string, leaseDurationMs?: number): CharacterImageJob;
  claimForCancellation(jobId: string,
    leaseDurationMs?: number): CharacterImageJob;
  claimNext(leaseDurationMs?: number): CharacterImageJob | null;
  get(jobId: string): CharacterImageJob;
  markSubmitIntent(jobId: string, leaseToken: string,
    providerClientId: string): CharacterImageJob;
  clearProviderTask(jobId: string, leaseToken: string): CharacterImageJob;
  markQueued(jobId: string, leaseToken: string,
    providerJobId: string): CharacterImageJob;
  markRunning(jobId: string, leaseToken: string): CharacterImageJob;
  heartbeat(jobId: string, leaseToken: string,
    leaseDurationMs?: number): CharacterImageJob;
  fail(jobId: string, leaseToken: string, errorCode: CharacterImageFailureCode,
    errorMessage: string): CharacterImageJob;
  forceFail(jobId: string, leaseToken: string,
    errorCode: CharacterImageFailureCode,
    errorMessage: string): CharacterImageJob;
  defer(jobId: string, leaseToken: string, errorCode: CharacterImageFailureCode,
    errorMessage: string): CharacterImageJob;
  cancel(jobId: string, reason?: string): CharacterImageJob;
  listEvents(jobId: string): CharacterImageJobEvent[];
  finalizeOutput(jobId: string, leaseToken: string,
    input: FinalizeCharacterImageOutputInput): CharacterImageOutputResult;
}

export interface CharacterImageWorkerStore {
  readonly characterImageJobs: CharacterImageJobStoreLike;
  getAsset(assetId: string): Asset;
}

export interface CharacterImageWorkerOptions {
  store: CharacterImageWorkerStore;
  client: ComfyUIClient;
  gpu_coordinator: SharedGpuCoordinator;
  data_directory: string;
  lease_duration_ms?: number;
  idle_interval_ms?: number;
  on_error?: (error: unknown) => void;
}

export type CharacterImageWorkerResult =
  | { outcome: 'idle' }
  | { outcome: 'completed'; job_id: string; provider_task_id: string;
    output_path: string }
  | { outcome: 'failed'; job_id: string; error_code: CharacterImageFailureCode;
    error_message: string }
  | { outcome: 'timed_out'; job_id: string; provider_task_id: string;
    error_code: CharacterImageFailureCode; error_message: string };

export class CharacterImageWorkerError extends Error {
  constructor(readonly code: CharacterImageFailureCode, message: string,
    options?: ErrorOptions) {
    super(message, options);
    this.name = 'CharacterImageWorkerError';
  }
}

export async function loadCharacterImageSources(dataDirectory: string,
  store: CharacterImageWorkerStore, job: CharacterImageJob) {
  const sources: Array<{ bytes: Buffer; filename: string }> = [];
  for (const [ordinal, frozen] of job.source_inputs.entries()) {
    const asset = store.getAsset(frozen.asset_id);
    if (asset.status !== 'approved' || asset.kind !== 'image' ||
      asset.content_hash !== frozen.content_hash) throw new CharacterImageWorkerError(
      'IMAGE_INPUT_MISSING', 'Frozen character image input is no longer approved');
    const path = safeImagePath(dataDirectory, asset.relative_path);
    let bytes: Buffer;
    try { bytes = await readFile(path); }
    catch (error) { throw new CharacterImageWorkerError(
      'IMAGE_INPUT_MISSING', 'Frozen character image input file is missing', {
        cause: error,
      }); }
    const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (hash !== frozen.content_hash) throw new CharacterImageWorkerError(
      'IMAGE_INPUT_MISSING', 'Frozen character image input hash changed');
    try { await decodeCharacterImage(bytes); }
    catch (error) { throw new CharacterImageWorkerError(
      'IMAGE_INPUT_MISSING', 'Frozen character image input cannot be decoded', {
        cause: error,
      }); }
    sources.push({ bytes,
      filename: `${job.id}-source${ordinal}${extname(asset.relative_path)}` });
  }
  return sources;
}

export function buildCharacterImageGraph(job: CharacterImageJob,
  sourceNames: readonly string[]): ComfyGraph {
  const common = { prompt: job.prompt, seed: job.seed, width: job.width,
    height: job.height, steps: job.steps, cfg: job.cfg, sampler: job.sampler,
    scheduler: job.scheduler, filename_prefix: `h3storyboard/${job.id}` };
  const lora = job.lora_name === null ? null : {
    name: job.lora_name, strength: job.lora_strength!,
  };
  if (job.operation === 'master_t2i') return buildKreaMasterGraph({
    ...common, lora,
  });
  if (job.operation === 'variant_i2i') {
    if (!sourceNames[0] || job.denoise === null) throw new CharacterImageWorkerError(
      'IMAGE_INPUT_MISSING', 'Krea variant requires one source and denoise');
    return buildKreaVariantGraph({ ...common, lora,
      source_image: sourceNames[0], denoise: job.denoise });
  }
  return buildQwenIdentityGraph({ ...common, source_images: sourceNames,
    denoise: job.denoise ?? 1 });
}

export async function writeCharacterImageOutput(dataDirectory: string,
  job: CharacterImageJob, bytes: Uint8Array) {
  const decoded = await decodeCharacterImage(bytes);
  const extension = decoded.mime_type === 'image/png' ? 'png' :
    decoded.mime_type === 'image/jpeg' ? 'jpg' : 'webp';
  const relativePath = `assets/characters/${job.project_id}/generated/` +
    `${job.id}-${job.attempt}-${job.lease_token}.${extension}`;
  const absolutePath = safeImagePath(dataDirectory, relativePath);
  const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;
  await mkdir(dirname(absolutePath), { recursive: true });
  try {
    await writeFile(temporaryPath, bytes, { flag: 'wx', mode: 0o600 });
    await rename(temporaryPath, absolutePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw new CharacterImageWorkerError('IMAGE_OUTPUT_INVALID',
      'Could not persist generated character image', { cause: error });
  }
  return { absolutePath, relativePath,
    name: basename(relativePath),
    contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
}

export function characterImageFailure(error: unknown): {
  code: CharacterImageFailureCode; message: string;
} {
  if (error instanceof CharacterImageValidationError) return {
    code: 'IMAGE_OUTPUT_INVALID', message: error.message,
  };
  if (error instanceof CharacterImageWorkerError) return {
    code: error.code, message: error.message,
  };
  if (error instanceof H3ComfyError) return {
    code: comfyFailureCodes[error.code] ?? 'IMAGE_COMFY_HTTP',
    message: error.message,
  };
  if (typeof error === 'object' && error !== null &&
    typeof (error as { code?: unknown }).code === 'string') {
    const rawCode = (error as { code: string }).code;
    const mappedCode = rawCode === 'GPU_LEASE_BUSY' ?
      'IMAGE_COMFY_QUEUE_BUSY' : comfyFailureCodes[rawCode] ?? rawCode;
    const parsedCode = CharacterImageFailureCodeSchema.safeParse(mappedCode);
    const code = parsedCode.success ? parsedCode.data : 'IMAGE_WORKER_FAILED';
    return { code, message: error instanceof Error ? error.message :
      'Character image worker failed' };
  }
  return { code: 'IMAGE_WORKER_FAILED', message: error instanceof Error
    ? error.message : 'Character image worker failed' };
}

export function safeImagePath(dataDirectory: string,
  relativePath: string): string {
  const root = resolve(dataDirectory);
  const parsed = RelativeAssetPathSchema.safeParse(relativePath);
  if (!parsed.success) throw new CharacterImageWorkerError(
    'IMAGE_INPUT_MISSING', 'Character image path must remain project-relative');
  const absolute = resolve(root, parsed.data);
  if (!absolute.startsWith(`${root}${sep}`)) throw new CharacterImageWorkerError(
    'IMAGE_INPUT_MISSING', 'Character image path escaped the data directory');
  return absolute;
}

const comfyFailureCodes: Readonly<Record<string, CharacterImageFailureCode>> = {
  H3_COMFY_QUEUE_BUSY: 'IMAGE_COMFY_QUEUE_BUSY',
  H3_COMFY_GPU_INSUFFICIENT: 'IMAGE_GPU_INSUFFICIENT',
  H3_COMFY_CAPABILITY_MISMATCH: 'IMAGE_CAPABILITY_MISMATCH',
  H3_COMFY_HTTP_ERROR: 'IMAGE_COMFY_HTTP',
  H3_COMFY_PROTOCOL_ERROR: 'IMAGE_COMFY_NODE_ERROR',
  H3_COMFY_TIMEOUT: 'IMAGE_COMFY_TIMEOUT',
  H3_COMFY_TASK_MISSING: 'IMAGE_COMFY_TASK_MISSING',
  H3_COMFY_OUTPUT_MISSING: 'IMAGE_OUTPUT_MISSING',
  H3_COMFY_EMPTY_DOWNLOAD: 'IMAGE_OUTPUT_INVALID',
  H3_COMFY_ABORTED: 'IMAGE_COMFY_ABORTED',
};
