import { useCallback, useEffect, useState } from 'react';
import type { CreateAssetInput, UpdateAssetInput } from '@h3storyboard/protocol';
import * as api from './api.js';

function describeError(error: unknown): string {
  if (error instanceof api.ApiError) return `${error.message} · ${error.code}`;
  return error instanceof Error ? error.message : '资产操作失败';
}

export function useAssets(projectId: string) {
  const [assets, setAssets] = useState<Awaited<ReturnType<typeof api.listAssets>>>([]);
  const [manifests, setManifests] = useState<Awaited<
    ReturnType<typeof api.listAssetManifests>>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [loadedAssets, loadedManifests] = await Promise.all([
        api.listAssets(projectId), api.listAssetManifests(projectId),
      ]);
      setAssets(loadedAssets);
      setManifests(loadedManifests);
      setError(null);
    } catch (loadError) {
      setError(describeError(loadError));
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await operation();
      await load();
      return true;
    } catch (operationError) {
      setError(describeError(operationError));
      setBusy(false);
      return false;
    }
  };

  const create = (input: CreateAssetInput) => run(
    () => api.createAsset(projectId, input),
  );
  const update = (input: UpdateAssetInput) => run(
    () => api.updateAsset(projectId, input),
  );
  const freeze = () => run(() => api.freezeAssetManifest(projectId));

  return { assets, manifests, busy, error, create, update, freeze };
}
