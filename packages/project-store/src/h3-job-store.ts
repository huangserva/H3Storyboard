import type {
  CreateH3JobBatchInput,
  CreateH3JobBatchResult,
  CreateH3JobInput,
  H3Job,
  H3JobBatch,
  H3JobBatchList,
  JobEvent,
  RetryH3JobInput,
  RetryH3JobResult,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { claimH3Job, claimNextH3Job } from './h3-job-claim.js';
import { completeH3Job } from './job-completion.js';
import { createH3Job, createH3JobBatch } from './job-creation.js';
import {
  cancelH3Job,
  deferH3Job,
  failH3Job,
  forceFailH3Job,
  heartbeatH3Job,
  listH3JobEvents,
  recoverExpiredH3Jobs,
} from './job-lifecycle.js';
import {
  clearH3ProviderTask,
  markH3JobQueued,
  markH3JobRunning,
  markH3SubmitIntent,
} from './job-operations.js';
import { getJob } from './job-support.js';
import { getH3JobBatch, listH3JobBatches } from './h3-batch-operations.js';
import { retryH3Job } from './h3-job-retry.js';
import {
  finalizeWorkerOutput,
  type WorkerOutputInput,
  type WorkerOutputResult,
} from './worker-completion.js';

export class H3JobStore {
  constructor(protected readonly h3Database: Database.Database) {}

  createH3Job(shotPlanId: string, input: CreateH3JobInput): H3Job {
    return createH3Job(this.h3Database, shotPlanId, input);
  }

  createH3JobBatch(projectId: string,
    input: CreateH3JobBatchInput): CreateH3JobBatchResult {
    return createH3JobBatch(this.h3Database, projectId, input);
  }

  claimH3Job(jobId: string, leaseDurationMs?: number): H3Job {
    return claimH3Job(this.h3Database, jobId, leaseDurationMs);
  }

  claimNextH3Job(leaseDurationMs?: number): H3Job | null {
    return claimNextH3Job(this.h3Database, leaseDurationMs);
  }

  listH3JobBatches(projectId: string): H3JobBatchList {
    return listH3JobBatches(this.h3Database, projectId);
  }

  getH3JobBatch(projectId: string, batchId: string): H3JobBatch {
    return getH3JobBatch(this.h3Database, projectId, batchId);
  }

  retryH3Job(projectId: string, jobId: string,
    input: RetryH3JobInput): RetryH3JobResult {
    return retryH3Job(this.h3Database, projectId, jobId, input);
  }

  getH3Job(jobId: string): H3Job { return getJob(this.h3Database, jobId); }

  markH3SubmitIntent(jobId: string, leaseToken: string,
    providerClientId: string): H3Job {
    return markH3SubmitIntent(
      this.h3Database, jobId, leaseToken, providerClientId);
  }

  clearH3ProviderTask(jobId: string, leaseToken: string): H3Job {
    return clearH3ProviderTask(this.h3Database, jobId, leaseToken);
  }

  finalizeWorkerOutput(jobId: string, leaseToken: string,
    input: WorkerOutputInput): WorkerOutputResult {
    return finalizeWorkerOutput(this.h3Database, jobId, leaseToken, input);
  }

  markH3JobQueued(jobId: string, leaseToken: string,
    providerJobId: string): H3Job {
    return markH3JobQueued(
      this.h3Database, jobId, leaseToken, providerJobId);
  }

  markH3JobRunning(jobId: string, leaseToken: string): H3Job {
    return markH3JobRunning(this.h3Database, jobId, leaseToken);
  }

  completeH3Job(jobId: string, leaseToken: string,
    outputAssetId: string): H3Job {
    return completeH3Job(this.h3Database, jobId, leaseToken, outputAssetId);
  }

  heartbeatH3Job(jobId: string, leaseToken: string,
    leaseDurationMs?: number): H3Job {
    return heartbeatH3Job(
      this.h3Database, jobId, leaseToken, leaseDurationMs);
  }

  failH3Job(jobId: string, leaseToken: string,
    errorCode: string, errorMessage: string): H3Job {
    return failH3Job(
      this.h3Database, jobId, leaseToken, errorCode, errorMessage);
  }

  deferH3Job(jobId: string, leaseToken: string, errorCode: string,
    errorMessage: string): H3Job {
    return deferH3Job(
      this.h3Database, jobId, leaseToken, errorCode, errorMessage);
  }

  forceFailH3Job(jobId: string, leaseToken: string, errorCode: string,
    errorMessage: string): H3Job {
    return forceFailH3Job(
      this.h3Database, jobId, leaseToken, errorCode, errorMessage);
  }

  cancelH3Job(jobId: string, reason?: string): H3Job {
    return cancelH3Job(this.h3Database, jobId, reason);
  }

  recoverExpiredH3Jobs(now?: Date): number {
    return recoverExpiredH3Jobs(this.h3Database, now);
  }

  listH3JobEvents(jobId: string): JobEvent[] {
    return listH3JobEvents(this.h3Database, jobId);
  }
}
