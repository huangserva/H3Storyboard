import type {
  CharacterImageFailureCode,
  CharacterImageJob,
  CharacterImageJobEvent,
  CharacterImageOutputResult,
  CreateCharacterImageJobInput,
  FinalizeCharacterImageOutputInput,
  RetryCharacterImageJobInput,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import {
  createCharacterImageJob,
  listCharacterImageJobs,
  retryCharacterImageJob,
} from './character-image-job-operations.js';
import {
  claimCharacterImageJob,
  claimCharacterImageJobForCancellation,
  claimNextCharacterImageJob,
  clearCharacterImageProviderTask,
  markCharacterImageJobQueued,
  markCharacterImageJobRunning,
  markCharacterImageSubmitIntent,
} from './character-image-job-claim.js';
import {
  cancelCharacterImageJob,
  deferCharacterImageJob,
  failCharacterImageJob,
  forceFailCharacterImageJob,
  heartbeatCharacterImageJob,
  listCharacterImageJobEvents,
  recoverExpiredCharacterImageJobs,
} from './character-image-job-lifecycle.js';
import { finalizeCharacterImageOutput } from './character-image-job-completion.js';
import { getCharacterImageJob } from './character-image-job-support.js';

export class CharacterImageJobStore {
  constructor(private readonly database: Database.Database) {}

  create(projectId: string, characterId: string,
    input: CreateCharacterImageJobInput): CharacterImageJob {
    return createCharacterImageJob(
      this.database,
      projectId,
      characterId,
      input,
    );
  }

  list(projectId: string, characterId?: string): CharacterImageJob[] {
    return listCharacterImageJobs(this.database, projectId, characterId);
  }

  retry(projectId: string, jobId: string,
    input: RetryCharacterImageJobInput): CharacterImageJob {
    return retryCharacterImageJob(this.database, projectId, jobId, input);
  }

  get(jobId: string): CharacterImageJob {
    return getCharacterImageJob(this.database, jobId);
  }

  claim(jobId: string, leaseDurationMs?: number): CharacterImageJob {
    return claimCharacterImageJob(this.database, jobId, leaseDurationMs);
  }

  claimForCancellation(jobId: string,
    leaseDurationMs?: number): CharacterImageJob {
    return claimCharacterImageJobForCancellation(
      this.database, jobId, leaseDurationMs);
  }

  claimNext(leaseDurationMs?: number): CharacterImageJob | null {
    return claimNextCharacterImageJob(this.database, leaseDurationMs);
  }

  markSubmitIntent(jobId: string, leaseToken: string,
    providerClientId: string): CharacterImageJob {
    return markCharacterImageSubmitIntent(
      this.database,
      jobId,
      leaseToken,
      providerClientId,
    );
  }

  clearProviderTask(jobId: string, leaseToken: string): CharacterImageJob {
    return clearCharacterImageProviderTask(this.database, jobId, leaseToken);
  }

  markQueued(jobId: string, leaseToken: string,
    providerJobId: string): CharacterImageJob {
    return markCharacterImageJobQueued(
      this.database,
      jobId,
      leaseToken,
      providerJobId,
    );
  }

  markRunning(jobId: string, leaseToken: string): CharacterImageJob {
    return markCharacterImageJobRunning(this.database, jobId, leaseToken);
  }

  heartbeat(jobId: string, leaseToken: string,
    leaseDurationMs?: number): CharacterImageJob {
    return heartbeatCharacterImageJob(
      this.database,
      jobId,
      leaseToken,
      leaseDurationMs,
    );
  }

  fail(jobId: string, leaseToken: string, errorCode: CharacterImageFailureCode,
    errorMessage: string): CharacterImageJob {
    return failCharacterImageJob(
      this.database,
      jobId,
      leaseToken,
      errorCode,
      errorMessage,
    );
  }

  defer(jobId: string, leaseToken: string, errorCode: CharacterImageFailureCode,
    errorMessage: string): CharacterImageJob {
    return deferCharacterImageJob(
      this.database,
      jobId,
      leaseToken,
      errorCode,
      errorMessage,
    );
  }

  forceFail(jobId: string, leaseToken: string,
    errorCode: CharacterImageFailureCode,
    errorMessage: string): CharacterImageJob {
    return forceFailCharacterImageJob(
      this.database,
      jobId,
      leaseToken,
      errorCode,
      errorMessage,
    );
  }

  cancel(jobId: string, reason?: string): CharacterImageJob {
    return cancelCharacterImageJob(this.database, jobId, reason);
  }

  recoverExpired(now?: Date): number {
    return recoverExpiredCharacterImageJobs(this.database, now);
  }

  listEvents(jobId: string): CharacterImageJobEvent[] {
    return listCharacterImageJobEvents(this.database, jobId);
  }

  finalizeOutput(jobId: string, leaseToken: string,
    input: FinalizeCharacterImageOutputInput): CharacterImageOutputResult {
    return finalizeCharacterImageOutput(
      this.database,
      jobId,
      leaseToken,
      input,
    );
  }
}
