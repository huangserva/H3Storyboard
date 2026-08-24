import { useEffect, useRef, useState } from 'react';
import type { GenerationPreflight, ProjectSnapshot } from '@h3storyboard/protocol';
import * as api from './api.js';
import { mapWithConcurrency } from './bounded-map.js';

const PREFLIGHT_CONCURRENCY = 6;

export function useGenerationPreflights(snapshot: ProjectSnapshot | null,
  revision: number) {
  const [preflights, setPreflights] = useState<Map<string, GenerationPreflight>>(
    new Map());
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const loadKey = snapshot
    ? `${snapshot.project.id}:${snapshot.shot_plans.map(({ id }) => id).join(',')}`
    : 'none';

  useEffect(() => {
    let active = true;
    let running = false;
    const load = async () => {
      if (running) return;
      const current = snapshotRef.current;
      if (!current) { setPreflights(new Map()); return; }
      running = true;
      const entries = await mapWithConcurrency(current.shot_plans,
        PREFLIGHT_CONCURRENCY, async (shot) => {
          try {
            return [shot.id, await api.getGenerationPreflight(
              current.project.id, shot.id)] as const;
          } catch (error) {
            const code = error instanceof api.ApiError
              ? error.code : 'PREFLIGHT_FAILED';
            const message = error instanceof Error
              ? error.message : '生成检查失败';
            const failed: GenerationPreflight = { ready: false,
              blocking_error: { code, message }, mode: null,
              input_bindings: [], gate_override_required: false };
            return [shot.id, failed] as const;
          }
        });
      running = false;
      if (active && snapshotRef.current?.project.id === current.project.id) {
        setPreflights(new Map(entries));
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [loadKey, revision]);

  return preflights;
}
