import { useEffect, useRef, useState } from 'react';
import type { GenerationPreflight, GenerationPreflightBatch,
  ProjectSnapshot } from '@h3storyboard/protocol';
import * as api from './api.js';
import { SharedRequestRegistry, type SharedRequestLease } from
  './shared-request-registry.js';

const preflightLoads = new SharedRequestRegistry<GenerationPreflightBatch>();

export function useGenerationPreflights(snapshot: ProjectSnapshot | null,
  revision: number) {
  const [preflights, setPreflights] = useState<Map<string, GenerationPreflight>>(
    new Map());
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const loadKey = snapshot
    ? `${snapshot.project.id}:${snapshot.project.updated_at}:` +
      snapshot.shot_plans.map(({ id, updated_at }) => `${id}:${updated_at}`).join(',')
    : 'none';

  useEffect(() => {
    if (!snapshotRef.current) {
      setPreflights(new Map());
      return;
    }
    let active = true;
    let running = false;
    let pollDelay = 5_000;
    let timer: number | null = null;
    const leases = new Set<SharedRequestLease<GenerationPreflightBatch>>();
    const load = async () => {
      if (running) return;
      const current = snapshotRef.current;
      if (!current) { setPreflights(new Map()); return; }
      running = true;
      const lease = preflightLoads.acquire(`${loadKey}:${revision}`, (signal) =>
        api.getGenerationPreflights(current.project.id, signal));
      leases.add(lease);
      try {
        const batch = await lease.promise;
        if (active && snapshotRef.current?.project.id === current.project.id) {
          setPreflights(new Map(batch.items.map(({ shot_plan_id, preflight }) =>
            [shot_plan_id, preflight])));
        }
      } catch (error) {
        if (!active || isAbortError(error)) return;
        const code = error instanceof api.ApiError
          ? error.code : 'PREFLIGHT_BATCH_FAILED';
        const message = error instanceof Error ? error.message : '生成检查失败';
        const failed: GenerationPreflight = { ready: false,
          blocking_error: { code, message }, mode: null,
          input_bindings: [], gate_override_required: false,
          compiled_prompt: null, film_studio_revision: null };
        if (snapshotRef.current?.project.id === current.project.id) {
          setPreflights(new Map(current.shot_plans.map(({ id }) => [id, failed])));
        }
      } finally {
        lease.release();
        leases.delete(lease);
        running = false;
      }
    };
    const poll = async () => {
      await load();
      if (!active) return;
      timer = window.setTimeout(() => {
        pollDelay = Math.min(pollDelay * 2, 30_000);
        void poll();
      }, pollDelay);
    };
    void poll();
    return () => {
      active = false;
      for (const lease of leases) lease.release();
      leases.clear();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [loadKey, revision]);

  return preflights;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
