import type { CharacterImageJob } from '@h3storyboard/protocol';
import type { ComfyUIClient } from '@h3storyboard/h3-provider';
import { characterImageFailure, type CharacterImageWorkerStore } from
  './character-image-worker-support.js';
import { startCancellationDeadline, startLeaseHeartbeat } from
  './h3-worker-support.js';
import type { SharedGpuCoordinator } from './gpu-coordinator.js';

export interface ActiveImageExecution {
  controller: AbortController;
  cancelController: AbortController;
  cancelRequested: boolean;
  cancellation: Promise<CharacterImageJob> | null;
}

export interface CharacterImageCancellationOptions {
  store: CharacterImageWorkerStore;
  client: ComfyUIClient;
  gpu_coordinator: SharedGpuCoordinator;
  lease_duration_ms: number;
  on_error?: (error: unknown) => void;
}

export async function cancelCharacterImageJob(
  options: CharacterImageCancellationOptions,
  activeJobs: Map<string, ActiveImageExecution>,
  jobId: string,
  reason: string,
): Promise<CharacterImageJob> {
  const before = options.store.characterImageJobs.get(jobId);
  if (before.status === 'canceled' || !cancelableStatuses.has(before.status)) {
    return options.store.characterImageJobs.cancel(jobId, reason);
  }
  const active = activeJobs.get(jobId);
  if (!before.provider_job_id && !before.provider_client_id) {
    const canceled = options.store.characterImageJobs.cancel(jobId, reason);
    active?.controller.abort();
    return canceled;
  }
  if (!active) return cancelInactive(options, before, reason);
  if (active.cancellation) return active.cancellation;
  active.cancelRequested = true;
  const cancellation = cancelActive(options, before, active, reason);
  active.cancellation = cancellation;
  try { return await cancellation; }
  catch (error) {
    if (active.cancellation === cancellation) active.cancellation = null;
    throw error;
  }
}

async function cancelActive(options: CharacterImageCancellationOptions,
  job: CharacterImageJob, active: ActiveImageExecution,
  reason: string): Promise<CharacterImageJob> {
  let providerJobId = job.provider_job_id;
  let signal = active.controller.signal;
  if (!providerJobId) {
    active.controller.abort();
    signal = active.cancelController.signal;
    providerJobId = await options.client.findTaskByClientId(
      job.provider_client_id!, signal, 3);
  }
  if (providerJobId) {
    await options.gpu_coordinator.prepareRecovery(
      options.client, providerJobId, signal);
    await options.client.cancelTask(providerJobId, signal);
  }
  const canceled = options.store.characterImageJobs.cancel(job.id, reason);
  active.controller.abort();
  return canceled;
}

async function cancelInactive(options: CharacterImageCancellationOptions,
  job: CharacterImageJob, reason: string): Promise<CharacterImageJob> {
  const claim = job.status === 'timed_out'
    ? options.store.characterImageJobs.claimForCancellation(
      job.id, options.lease_duration_ms) : null;
  const controller = new AbortController();
  let gpuLeaseToken: string | null = null;
  let stopHeartbeat: () => void = () => undefined;
  let stopDeadline: () => void = () => undefined;
  try {
    gpuLeaseToken = options.gpu_coordinator.acquire(
      'character_image', job.id).lease_token;
    stopHeartbeat = startLeaseHeartbeat(options.lease_duration_ms, () => {
      options.gpu_coordinator.heartbeat(gpuLeaseToken!);
      const jobLeaseToken = claim?.lease_token ?? job.lease_token;
      if (jobLeaseToken) options.store.characterImageJobs.heartbeat(
        job.id, jobLeaseToken, options.lease_duration_ms);
    }, (error) => {
      controller.abort(error);
      options.on_error?.(error);
    });
    stopDeadline = startCancellationDeadline(
      options.lease_duration_ms, controller);
    const providerJobId = job.provider_job_id ??
      await options.client.findTaskByClientId(
        job.provider_client_id!, controller.signal, 3);
    if (providerJobId) {
      await options.gpu_coordinator.prepareRecovery(
        options.client, providerJobId, controller.signal);
      await options.client.cancelTask(providerJobId, controller.signal);
    }
    return options.store.characterImageJobs.cancel(job.id, reason);
  } catch (error) {
    stopHeartbeat();
    stopDeadline();
    if (claim?.lease_token) {
      const failure = characterImageFailure(error);
      try { options.store.characterImageJobs.defer(
        job.id, claim.lease_token, failure.code, failure.message); }
      catch (deferError) { options.on_error?.(deferError); }
    }
    throw error;
  } finally {
    stopHeartbeat();
    stopDeadline();
    if (gpuLeaseToken) {
      try { options.gpu_coordinator.release(gpuLeaseToken); }
      catch (error) { options.on_error?.(error); }
    }
  }
}

const cancelableStatuses = new Set([
  'draft', 'submitting', 'queued', 'running', 'timed_out',
]);
