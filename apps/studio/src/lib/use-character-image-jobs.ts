import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CHARACTER_IMAGE_MAX_AUTO_ATTEMPTS,
  type CharacterImageJob,
  type CharacterImageJobStatus,
  type CreateCharacterImageJobInput,
} from '@h3storyboard/protocol';
import * as api from './api.js';
import { SharedRequestRegistry } from './shared-request-registry.js';

const imageJobLoads = new SharedRequestRegistry<CharacterImageJob[]>();
const ACTIVE_STATUSES = new Set<CharacterImageJobStatus>([
  'draft', 'submitting', 'queued', 'running',
]);

export function isCharacterImageJobActive(status: CharacterImageJobStatus) {
  return ACTIVE_STATUSES.has(status);
}

export function shouldPollCharacterImageJob(job: CharacterImageJob) {
  return isCharacterImageJobActive(job.status) ||
    (job.status === 'timed_out' &&
      job.attempt < CHARACTER_IMAGE_MAX_AUTO_ATTEMPTS);
}

function describeError(error: unknown): string {
  if (error instanceof api.ApiError) return `${error.message} · ${error.code}`;
  return error instanceof Error ? error.message : '角色图任务失败';
}

function upsert(jobs: CharacterImageJob[], next: CharacterImageJob) {
  return [next, ...jobs.filter(({ id }) => id !== next.id)].sort(
    (left, right) => right.created_at.localeCompare(left.created_at),
  );
}

export function useCharacterImageJobs(projectId: string) {
  const [jobs, setJobs] = useState<CharacterImageJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasActive = useMemo(() => jobs.some(shouldPollCharacterImageJob), [jobs]);

  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      const listed = await api.listCharacterImageJobs(projectId, signal);
      setJobs(listed);
      setError(null);
      return true;
    } catch (loadError) {
      if (signal?.aborted) return false;
      setError(describeError(loadError));
      return false;
    }
  }, [projectId]);

  useEffect(() => {
    let active = true;
    setJobs([]);
    setError(null);
    setBusy(true);
    const lease = imageJobLoads.acquire(projectId, (signal) =>
      api.listCharacterImageJobs(projectId, signal));
    void lease.promise.then((listed) => {
      if (!active) return;
      setJobs(listed);
      setBusy(false);
    }, (loadError: unknown) => {
      if (!active) return;
      setError(describeError(loadError));
      setBusy(false);
    });
    return () => { active = false; lease.release(); };
  }, [projectId]);

  useEffect(() => {
    if (!hasActive) return;
    let controller: AbortController | null = null;
    const timer = window.setInterval(() => {
      controller?.abort();
      controller = new AbortController();
      void reload(controller.signal);
    }, 2_000);
    return () => { window.clearInterval(timer); controller?.abort(); };
  }, [hasActive, reload]);

  const create = async (characterId: string,
    input: CreateCharacterImageJobInput) => {
    setBusy(true);
    try {
      const created = await api.createCharacterImageJob(
        projectId, characterId, input);
      setJobs((current) => upsert(current, created));
      setError(null);
      return created;
    } catch (operationError) {
      setError(describeError(operationError));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const retry = async (jobId: string) => {
    setBusy(true);
    try {
      const retried = await api.retryCharacterImageJob(projectId, jobId, {
        idempotency_key: `studio-retry-${crypto.randomUUID()}`,
      });
      setJobs((current) => upsert(current, retried));
      setError(null);
      return retried;
    } catch (operationError) {
      setError(describeError(operationError));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (jobId: string) => {
    setBusy(true);
    try {
      const canceled = await api.cancelCharacterImageJob(
        projectId, jobId, 'Director canceled character image generation.');
      setJobs((current) => upsert(current, canceled));
      setError(null);
      return canceled;
    } catch (operationError) {
      setError(describeError(operationError));
      return null;
    } finally {
      setBusy(false);
    }
  };

  return { jobs, busy, error, hasActive, reload, create, retry, cancel };
}
