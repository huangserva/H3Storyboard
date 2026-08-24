import { H3ComfyError, type ComfyUIClient, type H3Lora,
  type H3R2VLoader } from '@h3storyboard/h3-provider';
import { RelativeAssetPathSchema, type H3Job,
  type ProjectSnapshot } from '@h3storyboard/protocol';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { SharedGpuCoordinator } from './gpu-coordinator.js';

export interface WorkerCompletionInput {
  name: string;
  relative_path: string;
  content_hash: string;
  observed_description: string;
}

export interface H3WorkerStore {
  recoverExpiredH3Jobs(now?: Date): number;
  claimH3Job(jobId: string, leaseDurationMs?: number): H3Job;
  claimNextH3Job(leaseDurationMs?: number): H3Job | null;
  getProjectSnapshot(projectId: string): ProjectSnapshot;
  getH3Job(jobId: string): H3Job;
  markH3SubmitIntent(jobId: string, leaseToken: string,
    providerClientId: string): H3Job;
  clearH3ProviderTask(jobId: string, leaseToken: string): H3Job;
  markH3JobQueued(jobId: string, leaseToken: string,
    providerJobId: string): H3Job;
  markH3JobRunning(jobId: string, leaseToken: string): H3Job;
  heartbeatH3Job(jobId: string, leaseToken: string,
    leaseDurationMs?: number): H3Job;
  failH3Job(jobId: string, leaseToken: string, errorCode: string,
    errorMessage: string): H3Job;
  forceFailH3Job(jobId: string, leaseToken: string, errorCode: string,
    errorMessage: string): H3Job;
  deferH3Job(jobId: string, leaseToken: string, errorCode: string,
    errorMessage: string): H3Job;
  cancelH3Job(jobId: string, reason?: string): H3Job;
  finalizeWorkerOutput(jobId: string, leaseToken: string,
    input: WorkerCompletionInput): unknown;
}

export interface H3LeaseWorkerOptions {
  store: H3WorkerStore;
  client: ComfyUIClient;
  data_directory: string;
  lease_duration_ms?: number;
  idle_interval_ms?: number;
  width?: number;
  height?: number;
  fps?: number;
  turbo?: boolean;
  loras?: readonly H3Lora[];
  free_before_submit?: boolean;
  gpu_coordinator?: SharedGpuCoordinator;
  r2v_loader?: H3R2VLoader;
  on_error?: (error: unknown) => void;
}

export type H3WorkerRunResult =
  | { outcome: 'idle' }
  | { outcome: 'completed'; job_id: string; provider_task_id: string;
    output_path: string }
  | { outcome: 'failed'; job_id: string; error_code: string;
    error_message: string }
  | { outcome: 'timed_out'; job_id: string; provider_task_id: string;
    error_code?: string; error_message?: string };

export type H3WorkerErrorCode =
  | 'H3_WORKER_MODE_UNSUPPORTED'
  | 'H3_WORKER_SEED_REQUIRED'
  | 'H3_WORKER_INPUT_MISSING'
  | 'H3_WORKER_INPUT_READ_FAILED'
  | 'H3_WORKER_INPUT_EMPTY'
  | 'H3_WORKER_OUTPUT_WRITE_FAILED'
  | 'H3_WORKER_PATH_INVALID'
  | 'H3_WORKER_FAILED'
  | 'H3_WORKER_CONFIG_INVALID';

export function startLeaseHeartbeat(
  leaseDurationMs: number,
  heartbeat: () => void,
  onError?: (error: unknown) => void,
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
  timer = setInterval(() => {
    try { heartbeat(); }
    catch (error) {
      stop();
      onError?.(error);
    }
  }, Math.max(1, Math.floor(leaseDurationMs / 3)));
  timer.unref();
  return stop;
}

export function startCancellationDeadline(
  leaseDurationMs: number,
  controller: AbortController,
): () => void {
  const timer = setTimeout(() => controller.abort(new H3WorkerError(
    'H3_WORKER_FAILED', 'Provider cancellation exceeded its safety deadline')),
  Math.min(30_000, Math.max(1, Math.floor(leaseDurationMs / 2))));
  timer.unref();
  return () => clearTimeout(timer);
}

export class H3WorkerError extends Error {
  constructor(readonly code: H3WorkerErrorCode, message: string,
    options?: ErrorOptions) {
    super(message, options);
    this.name = 'H3WorkerError';
  }
}

export function safeDataPath(dataDirectory: string, relativePath: string): string {
  const parsed = RelativeAssetPathSchema.safeParse(relativePath);
  if (!parsed.success) throw new H3WorkerError('H3_WORKER_PATH_INVALID',
    'Worker asset path must remain project-relative');
  const absolute = resolve(dataDirectory, parsed.data);
  if (!absolute.startsWith(`${dataDirectory}${sep}`)) throw new H3WorkerError(
    'H3_WORKER_PATH_INVALID', 'Worker asset path escaped the data directory');
  return absolute;
}

export async function writeWorkerOutput(dataDirectory: string, job: H3Job,
  bytes: Uint8Array) {
  const ownership = `${job.attempt}-${job.lease_token}`;
  const relativePath = `projects/${job.project_id}/outputs/${job.id}-${ownership}.mp4`;
  const absolutePath = safeDataPath(dataDirectory, relativePath);
  const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;
  await mkdir(dirname(absolutePath), { recursive: true });
  try {
    await writeFile(temporaryPath, bytes, { flag: 'wx' });
    await rename(temporaryPath, absolutePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw new H3WorkerError('H3_WORKER_OUTPUT_WRITE_FAILED',
      'Could not persist the downloaded H3 output', { cause: error });
  }
  return { relativePath, absolutePath,
    contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
}

export function workerFailure(error: unknown): { code: string; message: string } {
  if (error instanceof H3ComfyError || error instanceof H3WorkerError) {
    return { code: error.code,
      message: error.message.trim().slice(0, 2_000) || 'H3 worker failed without details' };
  }
  if (typeof error === 'object' && error !== null &&
    typeof (error as { code?: unknown }).code === 'string') {
    return { code: (error as { code: string }).code,
      message: error instanceof Error ? error.message.trim().slice(0, 2_000) ||
        'H3 worker failed without details' : 'Worker failed' };
  }
  return { code: 'H3_WORKER_FAILED',
    message: error instanceof Error ? error.message.trim().slice(0, 2_000) ||
      'H3 worker failed without details' : 'Worker failed' };
}

export function workerDelay(milliseconds: number) {
  return new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
