import type { H3JobStatus } from '@h3storyboard/protocol';

const transitions: Readonly<Record<H3JobStatus, readonly H3JobStatus[]>> = {
  draft: ['submitting', 'canceled'],
  submitting: ['queued', 'failed', 'canceled', 'timed_out'],
  queued: ['running', 'failed', 'canceled', 'timed_out'],
  running: ['completed', 'failed', 'canceled', 'timed_out'],
  completed: [],
  failed: ['submitting'],
  canceled: [],
  timed_out: ['submitting'],
};

export class JobTransitionError extends Error {
  readonly code = 'INVALID_JOB_TRANSITION';

  constructor(
    readonly from_status: H3JobStatus,
    readonly to_status: H3JobStatus,
  ) {
    super(`Cannot transition H3 job from ${from_status} to ${to_status}`);
    this.name = 'JobTransitionError';
  }
}

export function canTransitionJob(
  fromStatus: H3JobStatus,
  toStatus: H3JobStatus,
): boolean {
  return transitions[fromStatus].includes(toStatus);
}

export function assertJobTransition(
  fromStatus: H3JobStatus,
  toStatus: H3JobStatus,
): void {
  if (!canTransitionJob(fromStatus, toStatus)) {
    throw new JobTransitionError(fromStatus, toStatus);
  }
}

export function isTerminalJobStatus(status: H3JobStatus): boolean {
  return status === 'completed' || status === 'canceled';
}
