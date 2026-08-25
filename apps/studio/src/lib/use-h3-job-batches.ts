import { useCallback, useEffect, useRef, useState } from 'react';
import type { H3JobBatch } from '@h3storyboard/protocol';
import * as api from './api.js';
import { describeError } from './studio-notice.js';

export function useH3JobBatches(projectId: string) {
  const [batches, setBatches] = useState<H3JobBatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const retryKeys = useRef(new Map<string, string>());
  const requestRevision = useRef(0);
  const currentProjectId = useRef(projectId);

  useEffect(() => {
    let active = true;
    currentProjectId.current = projectId;
    requestRevision.current += 1;
    setBatches([]);
    setRetryingJobId(null);
    const load = () => {
      const revision = requestRevision.current + 1;
      requestRevision.current = revision;
      void api.listH3JobBatches(projectId).then((listed) => {
        if (!active || revision !== requestRevision.current) return;
        setBatches(listed.batches); setError(null);
      }).catch((cause) => {
        if (active && revision === requestRevision.current) {
          setError(describeError(cause));
        }
      });
    };
    load();
    const timer = window.setInterval(load, 2_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [projectId]);

  const retry = useCallback(async (jobId: string) => {
    const key = retryKeys.current.get(jobId) ??
      `studio-retry-${crypto.randomUUID()}`;
    retryKeys.current.set(jobId, key);
    requestRevision.current += 1;
    setRetryingJobId(jobId);
    try {
      const result = await api.retryH3Job(projectId, jobId, key);
      retryKeys.current.delete(jobId);
      if (currentProjectId.current !== projectId) return false;
      if (result.batch) setBatches((current) => current.map((batch) =>
        batch.id === result.batch!.id ? result.batch! : batch));
      requestRevision.current += 1;
      setError(null);
      return true;
    } catch (cause) {
      if (currentProjectId.current === projectId) setError(describeError(cause));
      else retryKeys.current.delete(jobId);
      return false;
    } finally {
      if (currentProjectId.current === projectId) setRetryingJobId(null);
    }
  }, [projectId]);

  return { batches, error, retryingJobId, retry };
}
