import { useCallback, useEffect, useState } from 'react';
import type {
  CreateProductionBriefInput,
  ProductionBrief,
  ProjectGenerationLock,
  UpdateProjectGenerationLockInput,
} from '@h3storyboard/protocol';
import * as api from './api.js';

function describeError(error: unknown): string {
  if (error instanceof api.ApiError) return `${error.message} · ${error.code}`;
  return error instanceof Error ? error.message : 'Production context 操作失败';
}

export function useProduction(projectId: string) {
  const [briefs, setBriefs] = useState<ProductionBrief[]>([]);
  const [lock, setLock] = useState<ProjectGenerationLock | null>(null);
  const [modes, setModes] = useState<Awaited<ReturnType<typeof api.listModes>>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [loadedBriefs, loadedLock, loadedModes] = await Promise.all([
        api.listProductionBriefs(projectId), api.getGenerationLock(projectId),
        api.listModes(),
      ]);
      setBriefs(loadedBriefs); setLock(loadedLock); setModes(loadedModes);
      setError(null);
    } catch (loadError) { setError(describeError(loadError)); }
    finally { setBusy(false); }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    try { await operation(); await load(); return true; }
    catch (operationError) { setError(describeError(operationError));
      setBusy(false); return false; }
  };
  return { briefs, lock, modes, busy, error,
    createBrief: (input: CreateProductionBriefInput) => run(
      () => api.createProductionBrief(projectId, input)),
    updateLock: (input: UpdateProjectGenerationLockInput) => run(
      () => api.updateGenerationLock(projectId, input)) };
}
