import { useCallback, useEffect, useState } from 'react';
import type {
  Character,
  CharacterReference,
  CharacterAssetDerivation,
  Asset,
  CreateCharacterInput,
  UpdateCharacterInput,
} from '@h3storyboard/protocol';
import * as api from './api.js';
import { SharedRequestRegistry } from './shared-request-registry.js';

const catalogLoads = new SharedRequestRegistry<Awaited<
  ReturnType<typeof api.getCharacterCatalog>>>();

function describeError(error: unknown): string {
  if (error instanceof api.ApiError) return `${error.message} · ${error.code}`;
  return error instanceof Error ? error.message : '角色操作失败';
}

export function useCharacters(projectId: string) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [references, setReferences] = useState<CharacterReference[]>([]);
  const [referenceAssets, setReferenceAssets] = useState<Asset[]>([]);
  const [assetDerivations, setAssetDerivations] = useState<
    CharacterAssetDerivation[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const applyCatalog = useCallback((catalog: Awaited<
    ReturnType<typeof api.getCharacterCatalog>>) => {
    setCharacters(catalog.characters);
    setReferences(catalog.references);
    setReferenceAssets(catalog.assets);
    setAssetDerivations(catalog.asset_derivations);
  }, []);

  useEffect(() => {
    let active = true;
    setCharacters([]);
    setReferences([]);
    setReferenceAssets([]);
    setAssetDerivations([]);
    setError(null);
    setBusy(true);
    const lease = catalogLoads.acquire(projectId, (signal) =>
      api.getCharacterCatalog(projectId, signal));
    void lease.promise.then((catalog) => ({ loaded: catalog.characters,
      loadedReferences: catalog.references, loadedAssets: catalog.assets,
      loadedDerivations: catalog.asset_derivations })).then(
      ({ loaded, loadedReferences, loadedAssets, loadedDerivations }) => {
        if (!active) return;
        applyCatalog({ characters: loaded, references: loadedReferences,
          assets: loadedAssets, asset_derivations: loadedDerivations });
        setError(null);
        setBusy(false);
      },
      (loadError: unknown) => {
        if (!active) return;
        setError(describeError(loadError));
        setBusy(false);
      },
    );
    return () => { active = false; lease.release(); };
  }, [applyCatalog, projectId]);

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      applyCatalog(await api.getCharacterCatalog(projectId));
      setError(null);
      return true;
    } catch (operationError) {
      setError(describeError(operationError));
      return false;
    } finally {
      setBusy(false);
    }
  }, [applyCatalog, projectId]);

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

  const uploadReference = async (characterId: string, file: File,
    derivedFrom: string | null = null) => {
    setBusy(true);
    try {
      const result = await api.uploadCharacterReference(
        projectId, characterId, file, derivedFrom);
      applyCatalog(await api.getCharacterCatalog(projectId));
      setError(null);
      return result;
    } catch (operationError) {
      setError(describeError(operationError));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const approveReference = async (characterId: string, referenceId: string,
    makePrimary: boolean) => {
    setBusy(true);
    try {
      const result = await api.approveCharacterReference(
        projectId, characterId, referenceId, makePrimary);
      applyCatalog(await api.getCharacterCatalog(projectId));
      setError(null);
      return result;
    } catch (operationError) {
      setError(describeError(operationError));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const archiveReference = async (assetId: string) => {
    setBusy(true);
    try {
      await api.archiveCharacterReferenceAsset(projectId, assetId);
      applyCatalog(await api.getCharacterCatalog(projectId));
      setError(null);
      return true;
    } catch (operationError) {
      setError(describeError(operationError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { characters, references, referenceAssets, assetDerivations,
    busy, error, reload, create, update,
    uploadReference, approveReference, archiveReference };
}
