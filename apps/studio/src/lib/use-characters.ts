import { useEffect, useState } from 'react';
import type {
  Character,
  CreateCharacterInput,
  UpdateCharacterInput,
} from '@h3storyboard/protocol';
import * as api from './api.js';

function describeError(error: unknown): string {
  if (error instanceof api.ApiError) return `${error.message} · ${error.code}`;
  return error instanceof Error ? error.message : '角色操作失败';
}

export function useCharacters(projectId: string) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setBusy(true);
    void api.listCharacters(projectId).then(
      (loaded) => {
        if (!active) return;
        setCharacters(loaded);
        setBusy(false);
      },
      (loadError: unknown) => {
        if (!active) return;
        setError(describeError(loadError));
        setBusy(false);
      },
    );
    return () => { active = false; };
  }, [projectId]);

  const create = async (input: CreateCharacterInput) => {
    setBusy(true);
    try {
      const created = await api.createCharacter(projectId, input);
      setCharacters((current) => [...current, created]);
      setError(null);
      return true;
    } catch (operationError) {
      setError(describeError(operationError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const update = async (input: UpdateCharacterInput) => {
    setBusy(true);
    try {
      const updated = await api.updateCharacter(projectId, input);
      setCharacters((current) => current.map(
        (character) => character.id === updated.id ? updated : character,
      ));
      setError(null);
      return true;
    } catch (operationError) {
      setError(describeError(operationError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { characters, busy, error, create, update };
}
