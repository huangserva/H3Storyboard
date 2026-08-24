import type { CharacterImageJob } from '@h3storyboard/protocol';
import { rm } from 'node:fs/promises';
import {
  buildCharacterImageGraph,
  characterImageFailure,
  loadCharacterImageSources,
  writeCharacterImageOutput,
  type CharacterImageWorkerOptions,
  type CharacterImageWorkerResult,
} from './character-image-worker-support.js';
import { startLeaseHeartbeat, workerDelay } from './h3-worker-support.js';
import { cancelCharacterImageJob, type ActiveImageExecution } from
  './character-image-worker-cancel.js';

export * from './character-image-worker-support.js';

export class CharacterImageLeaseWorker {
  readonly #options: Required<Omit<CharacterImageWorkerOptions, 'on_error'>> &
    Pick<CharacterImageWorkerOptions, 'on_error'>;
  #stopping = false;
  #loop: Promise<void> | null = null;
  readonly #active = new Map<string, ActiveImageExecution>();

  constructor(options: CharacterImageWorkerOptions) {
    this.#options = { ...options,
      lease_duration_ms: options.lease_duration_ms ?? 60 * 60_000,
      idle_interval_ms: options.idle_interval_ms ?? 1_000 };
    if (options.client.poll_window_ms >= this.#options.lease_duration_ms) {
      throw new Error('Character image poll window must be shorter than its lease');
    }
  }

  async runOnce(): Promise<CharacterImageWorkerResult> {
    this.#options.store.characterImageJobs.recoverExpired();
    const job = this.#options.store.characterImageJobs.claimNext(
      this.#options.lease_duration_ms);
    if (!job) return { outcome: 'idle' };
    const leaseToken = job.lease_token!;
    let gpuLeaseToken: string | null = null;
    let ownedOutputPath: string | null = null;
    const controller = new AbortController();
    const active: ActiveImageExecution = { controller,
      cancelController: new AbortController(), cancelRequested: false,
      cancellation: null };
    this.#active.set(job.id, active);
    const stopLeaseHeartbeat = startLeaseHeartbeat(
      this.#options.lease_duration_ms,
      () => {
        if (gpuLeaseToken) this.#options.gpu_coordinator.heartbeat(gpuLeaseToken);
        this.#options.store.characterImageJobs.heartbeat(
          job.id, leaseToken, this.#options.lease_duration_ms);
      },
      (error) => {
        controller.abort(error);
        this.#options.on_error?.(error);
      },
    );
    try {
      gpuLeaseToken = this.#options.gpu_coordinator.acquire(
        'character_image', job.id).lease_token;
      const providerTaskId = await this.#resolveProviderTask(
        job, leaseToken, controller.signal);
      this.#options.store.characterImageJobs.markQueued(
        job.id, leaseToken, providerTaskId);
      this.#options.store.characterImageJobs.markRunning(job.id, leaseToken);
      this.#heartbeat(job.id, leaseToken, gpuLeaseToken);
      const history = await this.#options.client.pollHistory(providerTaskId, {
        signal: controller.signal,
        on_attempt: () => {
          const current = this.#options.store.characterImageJobs.get(job.id);
          if (current.status === 'canceled') controller.abort();
          else this.#heartbeat(job.id, leaseToken, gpuLeaseToken!);
        },
      });
      this.#heartbeat(job.id, leaseToken, gpuLeaseToken);
      const output = this.#options.client.firstImageOutput(history);
      const bytes = await this.#options.client.downloadOutput(
        output, controller.signal);
      const written = await writeCharacterImageOutput(
        this.#options.data_directory, job, bytes);
      ownedOutputPath = written.absolutePath;
      this.#options.store.characterImageJobs.finalizeOutput(job.id, leaseToken, {
        name: written.name, relative_path: written.relativePath,
        content_hash: written.contentHash,
      });
      return { outcome: 'completed', job_id: job.id,
        provider_task_id: providerTaskId, output_path: written.relativePath };
    } catch (error) {
      stopLeaseHeartbeat();
      if (ownedOutputPath) await rm(ownedOutputPath,
        { force: true }).catch(() => undefined);
      const failure = characterImageFailure(error);
      await active.cancellation?.catch(() => undefined);
      const current = this.#options.store.characterImageJobs.get(job.id);
      if (current.status === 'canceled') return { outcome: 'failed',
        job_id: job.id, error_code: 'IMAGE_COMFY_ABORTED',
        error_message: 'Character image job was canceled' };
      if (this.#stopping && controller.signal.aborted) {
        this.#options.store.characterImageJobs.defer(job.id, leaseToken,
          'IMAGE_COMFY_TIMEOUT',
          'Character image worker stopped; provider task remains recoverable');
        return { outcome: 'timed_out', job_id: job.id,
          provider_task_id: current.provider_job_id ?? '',
          error_code: 'IMAGE_COMFY_TIMEOUT',
          error_message: 'Character image worker stopped' };
      }
      if (active.cancelRequested && controller.signal.aborted) {
        this.#options.store.characterImageJobs.defer(job.id, leaseToken,
          'IMAGE_COMFY_TIMEOUT',
          'Provider cancellation could not be confirmed; task remains recoverable');
        return { outcome: 'timed_out', job_id: job.id,
          provider_task_id: current.provider_job_id ?? '',
          error_code: 'IMAGE_COMFY_TIMEOUT',
          error_message: 'Provider cancellation could not be confirmed' };
      }
      if (recoverableFailureCodes.has(failure.code)) {
        this.#options.store.characterImageJobs.defer(job.id, leaseToken,
          failure.code, failure.message);
        return { outcome: 'timed_out', job_id: job.id,
          provider_task_id: current.provider_job_id ?? '',
          error_code: failure.code, error_message: failure.message };
      }
      try {
        this.#options.store.characterImageJobs.fail(job.id, leaseToken,
          failure.code, failure.message);
      } catch (failError) {
        this.#options.on_error?.(failError);
        this.#options.store.characterImageJobs.forceFail(job.id, leaseToken,
          failure.code, failure.message);
      }
      return { outcome: 'failed', job_id: job.id,
        error_code: failure.code, error_message: failure.message };
    } finally {
      stopLeaseHeartbeat();
      await active.cancellation?.catch(() => undefined);
      if (gpuLeaseToken) {
        try { this.#options.gpu_coordinator.release(gpuLeaseToken); }
        catch (error) { this.#options.on_error?.(error); }
      }
      if (this.#active.get(job.id) === active) this.#active.delete(job.id);
    }
  }

  async cancel(jobId: string, reason: string): Promise<CharacterImageJob> {
    return cancelCharacterImageJob(this.#cancellationOptions(),
      this.#active, jobId, reason);
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

  async #resolveProviderTask(job: CharacterImageJob,
    leaseToken: string, signal: AbortSignal): Promise<string> {
    if (job.provider_job_id && await this.#options.client.taskExists(
      job.provider_job_id, signal, 3)) {
      await this.#options.gpu_coordinator.prepareRecovery(
        this.#options.client, job.provider_job_id, signal);
      return job.provider_job_id;
    }
    if (job.provider_client_id) {
      const recovered = await this.#options.client.findTaskByClientId(
        job.provider_client_id, signal, 3);
      if (recovered) {
        await this.#options.gpu_coordinator.prepareRecovery(
          this.#options.client, recovered, signal);
        return recovered;
      }
      this.#options.store.characterImageJobs.clearProviderTask(
        job.id, leaseToken);
    } else if (job.provider_job_id) {
      this.#options.store.characterImageJobs.clearProviderTask(
        job.id, leaseToken);
    }
    const sources = await loadCharacterImageSources(
      this.#options.data_directory, this.#options.store, job);
    const placeholders = sources.map((_, ordinal) => `source-${ordinal}.png`);
    const graphForPreflight = buildCharacterImageGraph(job, placeholders);
    await this.#options.gpu_coordinator.prepareNewSubmission(signal, () =>
      this.#options.client.assertGraphCapabilities(graphForPreflight, signal));
    const clientId = this.#options.client.createClientId();
    this.#options.store.characterImageJobs.markSubmitIntent(
      job.id, leaseToken, clientId);
    const uploadedNames: string[] = [];
    for (const source of sources) uploadedNames.push(
      await this.#options.client.uploadImage(
        new Blob([Uint8Array.from(source.bytes)]), source.filename, signal));
    const graph = buildCharacterImageGraph(job, uploadedNames);
    return this.#options.client.submitPrompt(graph, clientId, signal);
  }

  #heartbeat(jobId: string, jobLeaseToken: string,
    gpuLeaseToken: string): void {
    this.#options.store.characterImageJobs.heartbeat(jobId, jobLeaseToken,
      this.#options.lease_duration_ms);
    this.#options.gpu_coordinator.heartbeat(gpuLeaseToken);
  }

  #cancellationOptions() {
    return { store: this.#options.store, client: this.#options.client,
      gpu_coordinator: this.#options.gpu_coordinator,
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

const recoverableFailureCodes = new Set([
  'IMAGE_COMFY_QUEUE_BUSY',
  'IMAGE_GPU_INSUFFICIENT',
  'IMAGE_COMFY_TIMEOUT',
  'IMAGE_COMFY_TASK_MISSING',
]);
