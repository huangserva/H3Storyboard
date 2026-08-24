import type { H3Job } from '@h3storyboard/protocol';
import type { ComfyUIClient } from '@h3storyboard/h3-provider';
import { H3WorkerError, startCancellationDeadline, startLeaseHeartbeat,
  workerFailure, type H3WorkerStore } from
  './h3-worker-support.js';
import type { SharedGpuCoordinator } from './gpu-coordinator.js';

export interface ActiveH3Execution {
  controller: AbortController;
  cancelController: AbortController;
  cancelRequested: boolean;
  cancellation: Promise<H3Job> | null;
}

export interface H3CancellationOptions {
  store: H3WorkerStore;
  client: ComfyUIClient;
  gpu_coordinator?: SharedGpuCoordinator;
  lease_duration_ms: number;
  on_error?: (error: unknown) => void;
}

export async function cancelH3Job(options: H3CancellationOptions,
  activeJobs: Map<string, ActiveH3Execution>, jobId: string,
  reason: string): Promise<H3Job> {
  const before = options.store.getH3Job(jobId);
  if (before.status === 'canceled' || !cancelableStatuses.has(before.status)) {
    return options.store.cancelH3Job(jobId, reason);
  }
  const active = activeJobs.get(jobId);
  if (!before.provider_job_id && !before.provider_client_id) {
    const canceled = options.store.cancelH3Job(jobId, reason);
    active?.controller.abort();
    return canceled;
  }
  if (!active) return cancelInactiveH3Job(options, before, reason);
  if (active.cancellation) return active.cancellation;
  active.cancelRequested = true;
  const cancellation = cancelActiveH3Job(options, before, active, reason);
  active.cancellation = cancellation;
  try { return await cancellation; }
  catch (error) {
    if (active.cancellation === cancellation) active.cancellation = null;
    throw error;
  }
}

export async function cancelActiveH3Job(options: H3CancellationOptions,
  job: H3Job, active: ActiveH3Execution, reason: string): Promise<H3Job> {
  let providerJobId = job.provider_job_id;
  let signal = active.controller.signal;
  if (!providerJobId) {
    active.controller.abort();
    signal = active.cancelController.signal;
    providerJobId = await options.client.findTaskByClientId(
      job.provider_client_id!, signal, 3);
  }
  if (providerJobId) {
    await options.gpu_coordinator?.prepareRecovery(
      options.client, providerJobId, signal);
    await options.client.cancelTask(providerJobId, signal);
  }
  const canceled = options.store.cancelH3Job(job.id, reason);
  active.controller.abort();
  return canceled;
}

export async function cancelInactiveH3Job(options: H3CancellationOptions,
  job: H3Job, reason: string): Promise<H3Job> {
  if (job.status === 'timed_out' && !options.gpu_coordinator) {
    throw new H3WorkerError('H3_WORKER_CONFIG_INVALID',
      'Canceling a timed-out provider task requires shared GPU coordination');
  }
  const claim = job.status === 'timed_out'
    ? options.store.claimH3Job(job.id, options.lease_duration_ms) : null;
  const controller = new AbortController();
  let gpuLeaseToken: string | null = null;
  let stopHeartbeat: () => void = () => undefined;
  let stopDeadline: () => void = () => undefined;
  try {
    gpuLeaseToken = options.gpu_coordinator?.acquire(
      'h3_video', job.id).lease_token ?? null;
    stopHeartbeat = startLeaseHeartbeat(options.lease_duration_ms, () => {
      if (gpuLeaseToken) options.gpu_coordinator?.heartbeat(gpuLeaseToken);
      const jobLeaseToken = claim?.lease_token ?? job.lease_token;
      if (jobLeaseToken) options.store.heartbeatH3Job(
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
      await options.gpu_coordinator?.prepareRecovery(
        options.client, providerJobId, controller.signal);
      await options.client.cancelTask(providerJobId, controller.signal);
    }
    return options.store.cancelH3Job(job.id, reason);
  } catch (error) {
    stopHeartbeat();
    stopDeadline();
    if (claim?.lease_token) {
      const failure = workerFailure(error);
      try { options.store.deferH3Job(job.id, claim.lease_token,
        failure.code, failure.message); }
      catch (deferError) { options.on_error?.(deferError); }
    }
    throw error;
  } finally {
    stopHeartbeat();
    stopDeadline();
    if (gpuLeaseToken) {
      try { options.gpu_coordinator?.release(gpuLeaseToken); }
      catch (error) { options.on_error?.(error); }
    }
  }
}

const cancelableStatuses = new Set([
  'draft', 'submitting', 'queued', 'running', 'timed_out',
]);
