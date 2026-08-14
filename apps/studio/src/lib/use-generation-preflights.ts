import { useEffect, useState } from 'react';
import type { GenerationPreflight, ProjectSnapshot } from '@h3storyboard/protocol';
import * as api from './api.js';

export function useGenerationPreflights(snapshot: ProjectSnapshot | null,
  revision: number) {
  const [preflights, setPreflights] = useState<Map<string, GenerationPreflight>>(
    new Map());

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!snapshot) { setPreflights(new Map()); return; }
      const entries = await Promise.all(snapshot.shot_plans.map(async (shot) => {
        try {
          return [shot.id, await api.getGenerationPreflight(
            snapshot.project.id, shot.id)] as const;
        } catch (error) {
          const code = error instanceof api.ApiError ? error.code : 'PREFLIGHT_FAILED';
          const message = error instanceof Error ? error.message : '生成检查失败';
          const failed: GenerationPreflight = { ready: false,
            blocking_error: { code, message }, mode: null,
            input_bindings: [], gate_override_required: false };
          return [shot.id, failed] as const;
        }
      }));
      if (active) setPreflights(new Map(entries));
    };
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [snapshot, revision]);

  return preflights;
}
