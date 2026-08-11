import { describe, expect, it } from 'vitest';
import {
  assertJobTransition,
  canTransitionJob,
  isTerminalJobStatus,
  JobTransitionError,
} from '@h3storyboard/task-engine';

describe('H3 job state machine', () => {
  it('allows the normal durable execution path', () => {
    expect(canTransitionJob('draft', 'submitting')).toBe(true);
    expect(canTransitionJob('submitting', 'queued')).toBe(true);
    expect(canTransitionJob('queued', 'running')).toBe(true);
    expect(canTransitionJob('running', 'completed')).toBe(true);
    expect(canTransitionJob('submitting', 'timed_out')).toBe(true);
  });

  it('keeps completed and canceled jobs terminal', () => {
    expect(isTerminalJobStatus('completed')).toBe(true);
    expect(isTerminalJobStatus('canceled')).toBe(true);
    expect(() => assertJobTransition('completed', 'running')).toThrow(
      JobTransitionError,
    );
    expect(() => assertJobTransition('canceled', 'queued')).toThrow(
      JobTransitionError,
    );
  });
});
