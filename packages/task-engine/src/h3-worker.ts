import {
  buildH3FL2VGraph,
  buildH3I2VGraph,
  buildH3R2VGraph,
  framesForDuration,
  type H3Lora,
} from '@h3storyboard/h3-provider';
import type { H3Job } from '@h3storyboard/protocol';
import { readFile, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import {
  H3WorkerError,
  safeDataPath,
  startLeaseHeartbeat,
  workerDelay,
  workerFailure,
  writeWorkerOutput,
  type H3LeaseWorkerOptions,
  type H3WorkerRunResult,
} from './h3-worker-support.js';
import {
  cancelH3Job,
  type ActiveH3Execution,
} from './h3-worker-cancel.js';

export * from './h3-worker-support.js';
export class H3LeaseWorker {
  readonly #options: Required<Omit<H3LeaseWorkerOptions,
    'loras' | 'on_error' | 'gpu_coordinator'>> &
    Pick<H3LeaseWorkerOptions, 'on_error'> &
    { loras: readonly H3Lora[] };
  readonly #gpuCoordinator: H3LeaseWorkerOptions['gpu_coordinator'];
  #stopping = false;
  #loop: Promise<void> | null = null;
  readonly #active = new Map<string, ActiveH3Execution>();

  constructor(options: H3LeaseWorkerOptions) {
    this.#gpuCoordinator = options.gpu_coordinator;
    this.#options = {
      ...options,
      data_directory: resolve(options.data_directory),
      lease_duration_ms: options.lease_duration_ms ?? 60 * 60_000,
      idle_interval_ms: options.idle_interval_ms ?? 1_000,
      width: options.width ?? 480,
      height: options.height ?? 864,
      fps: options.fps ?? 24,
      turbo: options.turbo ?? true,
      loras: options.loras ?? [],
      free_before_submit: options.free_before_submit ?? true,
      r2v_loader: options.r2v_loader ?? { kind: 'stock' },
    };
    const maximumPollWindow = Math.max(this.#options.client.poll_window_ms,
      framesForDuration(15, this.#options.fps) / 124 * 720_000);
    if (maximumPollWindow >= this.#options.lease_duration_ms) {
      throw new H3WorkerError('H3_WORKER_CONFIG_INVALID',
        'Maximum frame-scaled ComfyUI poll window must be shorter than the lease');
    }
  }

  async runOnce(): Promise<H3WorkerRunResult> {
    this.#options.store.recoverExpiredH3Jobs();
    const job = this.#options.store.claimNextH3Job(
      this.#options.lease_duration_ms);
    if (!job) return { outcome: 'idle' };
    const leaseToken = job.lease_token!;
    let gpuLeaseToken: string | null = null;
    let ownedOutputPath: string | null = null;
    const controller = new AbortController();
    const active: ActiveH3Execution = { controller,
      cancelController: new AbortController(), cancelRequested: false,
      cancellation: null };
    this.#active.set(job.id, active);
    const stopLeaseHeartbeat = startLeaseHeartbeat(
      this.#options.lease_duration_ms,
      () => {
        if (gpuLeaseToken) this.#gpuCoordinator?.heartbeat(gpuLeaseToken);
        this.#options.store.heartbeatH3Job(job.id, leaseToken,
          this.#options.lease_duration_ms);
      },
      (error) => {
        controller.abort(error);
        this.#options.on_error?.(error);
      },
    );
    try {
      gpuLeaseToken = this.#gpuCoordinator?.acquire('h3_video', job.id)
        .lease_token ?? null;
      const providerTaskId = await this.#resolveProviderTask(
        job, leaseToken, controller.signal);
      this.#options.store.markH3JobQueued(job.id, leaseToken, providerTaskId);
      this.#options.store.markH3JobRunning(job.id, leaseToken);
      this.#options.store.heartbeatH3Job(job.id, leaseToken,
        this.#options.lease_duration_ms);
      const dynamicBudgetMs = Math.max(this.#options.client.poll_window_ms,
        framesForDuration(job.duration_seconds, this.#options.fps) / 124 * 720_000);
      const maxAttempts = this.#options.client.poll_interval_ms === 0 ? undefined :
        Math.ceil(dynamicBudgetMs / this.#options.client.poll_interval_ms);
      const history = await this.#options.client.pollHistory(providerTaskId, {
        signal: controller.signal, ...(maxAttempts === undefined ? {} :
          { max_attempts: maxAttempts }),
        on_attempt: () => {
          const current = this.#options.store.getH3Job(job.id);
          if (current.status === 'canceled') controller.abort();
          else {
            this.#options.store.heartbeatH3Job(job.id, leaseToken,
              this.#options.lease_duration_ms);
            if (gpuLeaseToken) this.#gpuCoordinator?.heartbeat(gpuLeaseToken);
          }
        },
      });
      this.#options.store.heartbeatH3Job(job.id, leaseToken,
        this.#options.lease_duration_ms);
      const item = this.#options.client.firstOutput(history);
      const bytes = await this.#options.client.downloadOutput(
        item, controller.signal);
      const written = await writeWorkerOutput(
        this.#options.data_directory, job, bytes);
      ownedOutputPath = written.absolutePath;
      this.#options.store.finalizeWorkerOutput(job.id, leaseToken, {
        name: basename(written.relativePath),
        relative_path: written.relativePath,
        content_hash: written.contentHash,
        observed_description: `Generated by ${job.provider} task ${providerTaskId}`,
      });
      return { outcome: 'completed', job_id: job.id,
        provider_task_id: providerTaskId, output_path: written.relativePath };
    } catch (error) {
      stopLeaseHeartbeat();
      if (ownedOutputPath) await rm(ownedOutputPath, { force: true }).catch(() => undefined);
      const failure = workerFailure(error);
      await active.cancellation?.catch(() => undefined);
      const current = this.#options.store.getH3Job(job.id);
      if (current.status === 'canceled') return { outcome: 'failed', job_id: job.id,
        error_code: 'H3_COMFY_ABORTED', error_message: 'Job was canceled' };
      if (this.#stopping && controller.signal.aborted) {
        this.#options.store.deferH3Job(job.id, leaseToken,
          'H3_COMFY_TIMEOUT',
          'H3 worker stopped; provider task remains recoverable');
        return { outcome: 'timed_out', job_id: job.id,
          provider_task_id: current.provider_job_id ?? '',
          error_code: 'H3_COMFY_TIMEOUT', error_message: 'H3 worker stopped' };
      }
      if (active.cancelRequested && controller.signal.aborted) {
        this.#options.store.deferH3Job(job.id, leaseToken,
          'H3_COMFY_TIMEOUT',
          'Provider cancellation could not be confirmed; task remains recoverable');
        return { outcome: 'timed_out', job_id: job.id,
          provider_task_id: current.provider_job_id ?? '',
          error_code: 'H3_COMFY_TIMEOUT',
          error_message: 'Provider cancellation could not be confirmed' };
      }
      if (failure.code === 'H3_COMFY_TIMEOUT' ||
        failure.code === 'H3_COMFY_QUEUE_BUSY' ||
        failure.code === 'H3_COMFY_GPU_INSUFFICIENT' ||
        failure.code === 'GPU_LEASE_BUSY') {
        if (failure.code === 'H3_COMFY_TIMEOUT' && current.provider_job_id) {
          await this.#options.client.cancelTask(
          current.provider_job_id, controller.signal).catch(this.#options.on_error);
        }
        this.#options.store.deferH3Job(job.id, leaseToken,
          failure.code, failure.message);
        return { outcome: 'timed_out', job_id: job.id,
          provider_task_id: current.provider_job_id ?? '',
          error_code: failure.code, error_message: failure.message };
      }
      try {
        this.#options.store.failH3Job(job.id, leaseToken,
          failure.code, failure.message);
      } catch (failError) {
        this.#options.on_error?.(failError);
        this.#options.store.forceFailH3Job(job.id, leaseToken,
          failure.code, failure.message);
      }
      return { outcome: 'failed', job_id: job.id,
        error_code: failure.code, error_message: failure.message };
    } finally {
      stopLeaseHeartbeat();
      await active.cancellation?.catch(() => undefined);
      if (gpuLeaseToken) {
        try { this.#gpuCoordinator?.release(gpuLeaseToken); }
        catch (error) { this.#options.on_error?.(error); }
      }
      if (this.#active.get(job.id) === active) this.#active.delete(job.id);
    }
  }

  async cancel(jobId: string, reason: string): Promise<H3Job> {
    return cancelH3Job(this.#cancellationOptions(), this.#active, jobId, reason);
  }

  start(): void {
    if (this.#loop) return;
    this.#stopping = false;
    this.#loop = this.#runLoop();
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    for (const active of this.#active.values()) {
      active.controller.abort();
      active.cancelController.abort();
    }
    await this.#loop;
    this.#loop = null;
  }

  async #resolveProviderTask(job: H3Job, leaseToken: string,
    signal: AbortSignal): Promise<string> {
    if (job.provider_job_id && await this.#options.client.taskExists(
      job.provider_job_id, signal, 3)) {
      await this.#gpuCoordinator?.prepareRecovery(
        this.#options.client, job.provider_job_id, signal);
      return job.provider_job_id;
    }
    if (job.provider_client_id) {
      const claimed = await this.#options.client.findTaskByClientId(
        job.provider_client_id, signal, 3);
      if (claimed) {
        await this.#gpuCoordinator?.prepareRecovery(
          this.#options.client, claimed, signal);
        return claimed;
      }
      this.#options.store.clearH3ProviderTask(job.id, leaseToken);
    } else if (job.provider_job_id) {
      this.#options.store.clearH3ProviderTask(job.id, leaseToken);
    }
    if (this.#gpuCoordinator) await this.#gpuCoordinator.prepareNewSubmission(signal);
    else {
      await this.#options.client.assertQueueIdle(signal);
      if (this.#options.free_before_submit) await this.#options.client.free(signal);
    }
    const clientId = this.#options.client.createClientId();
    this.#options.store.markH3SubmitIntent(job.id, leaseToken, clientId);
    return this.#submit(job, clientId, signal);
  }

  async #submit(job: H3Job, clientId: string,
    signal: AbortSignal): Promise<string> {
    if (job.mode !== 'i2v' && job.mode !== 'fl2v' && job.mode !== 'r2v') {
      throw new H3WorkerError('H3_WORKER_MODE_UNSUPPORTED',
        'H3 worker supports i2v, fl2v, and r2v jobs');
    }
    if (job.seed === null) throw new H3WorkerError(
      'H3_WORKER_SEED_REQUIRED', 'H3 worker jobs require a persisted seed');
    const bindings = job.mode === 'r2v' ? [...(job.compiled_bindings ?? [])] :
      ['first_frame', ...(job.mode === 'fl2v' ? ['last_frame'] : [])].map(
        (purpose) => job.compiled_bindings?.find((binding) =>
          binding.purpose === purpose));
    if (bindings.length === 0 || bindings.some((binding) => !binding)) {
      throw new H3WorkerError('H3_WORKER_INPUT_MISSING',
        `Compiled ${job.mode} job has no required image inputs`);
    }
    const images: Array<{ path: string; bytes: Buffer }> = [];
    for (const binding of bindings) {
      const path = safeDataPath(this.#options.data_directory, binding!.uri);
      let bytes: Buffer;
      try { bytes = await readFile(path); }
      catch (error) { throw new H3WorkerError('H3_WORKER_INPUT_READ_FAILED',
        'Could not read a compiled image asset', { cause: error }); }
      if (bytes.byteLength === 0) throw new H3WorkerError(
        'H3_WORKER_INPUT_EMPTY', 'Compiled image asset is empty');
      images.push({ path, bytes });
    }
    const names: string[] = [];
    for (const [slot, image] of images.entries()) names.push(
      await this.#options.client.uploadImage(new Blob([Uint8Array.from(image.bytes)]),
        `${job.id}-slot${slot}-${basename(image.path)}`, signal));
    const common = { prompt: job.prompt, width: this.#options.width,
      height: this.#options.height,
      frames: framesForDuration(job.duration_seconds, this.#options.fps),
      fps: this.#options.fps, seed: job.seed, loras: this.#options.loras,
      steps: job.steps, turbo: this.#options.turbo,
      filename_prefix: `h3storyboard/${job.id}`,
      generate_audio: job.audio_mode === 'h3_native',
    };
    const graph = job.mode === 'i2v'
      ? buildH3I2VGraph({ ...common, start_name: names[0]! })
      : job.mode === 'fl2v'
        ? buildH3FL2VGraph({ ...common, start_name: names[0]!,
          end_name: names[1]! })
        : buildH3R2VGraph({ ...common, reference_names: names,
          loader: this.#options.r2v_loader });
    return this.#options.client.submitPrompt(graph, clientId, signal);
  }

  #cancellationOptions() {
    return { store: this.#options.store, client: this.#options.client,
      ...(this.#gpuCoordinator ? { gpu_coordinator: this.#gpuCoordinator } : {}),
      lease_duration_ms: this.#options.lease_duration_ms,
      ...(this.#options.on_error ? { on_error: this.#options.on_error } : {}) };
  }

  async #runLoop(): Promise<void> {
    while (!this.#stopping) {
      try { await this.runOnce(); }
      catch (error) { this.#options.on_error?.(error); }
      if (!this.#stopping) await workerDelay(this.#options.idle_interval_ms);
    }
  }
}
