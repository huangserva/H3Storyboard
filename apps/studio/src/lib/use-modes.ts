import { useCallback, useEffect, useState } from 'react';
import type { CreateModeInput, Mode, UpdateModeInput } from '@h3storyboard/protocol';
import * as api from './api.js';

function describeError(error: unknown): string {
  if (error instanceof api.ApiError) return `${error.message} · ${error.code}`;
  return error instanceof Error ? error.message : 'Mode 操作失败';
}

export function useModes() {
  const [modes, setModes] = useState<Mode[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setModes(await api.listModes());
      setError(null);
    } catch (loadError) {
      setError(describeError(loadError));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (operation: () => Promise<Mode>) => {
    setBusy(true);
    try {
      const result = await operation();
      setModes((current) => current.some(({ id }) => id === result.id)
        ? current.map((mode) => mode.id === result.id ? result : mode)
        : [...current, result].sort((a, b) => a.key.localeCompare(b.key)));
      setError(null);
      return true;
    } catch (operationError) {
      setError(describeError(operationError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return {
    modes, busy, error,
    create: (input: CreateModeInput) => run(() => api.createMode(input)),
    update: (input: UpdateModeInput) => run(() => api.updateMode(input)),
  };
}
