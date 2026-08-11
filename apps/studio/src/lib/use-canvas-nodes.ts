import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CanvasNode,
  ProjectSnapshot,
  UpdateCanvasNodeInput,
} from '@h3storyboard/protocol';
import { createInitialPositions, parseStoredPositions } from './canvas-layout.js';
import * as api from './api.js';

const CARD_WIDTH = 260;
const CARD_HEIGHT = 196;
const pendingLoads = new Map<string, Promise<CanvasNode[]>>();

async function loadNodes(snapshot: ProjectSnapshot): Promise<CanvasNode[]> {
  const projectId = snapshot.project.id;
  const storageKey = `h3storyboard.canvas.v1.${projectId}`;
  const serialized = localStorage.getItem(storageKey);
  const stored = parseStoredPositions(serialized);
  const defaults = createInitialPositions(snapshot.shot_plans);
  const existing = await api.listCanvasNodes(projectId);
  const byRefId = new Map(existing.map((node) => [node.ref_id, node]));
  const nodes: CanvasNode[] = existing.filter(
    ({ node_type }) => node_type === 'character',
  );

  for (const shot of snapshot.shot_plans) {
    const persisted = byRefId.get(shot.id);
    const legacy = stored[shot.id];
    if (persisted) {
      nodes.push(
        legacy
          ? await api.updateCanvasNode(projectId, {
              node_id: persisted.id,
              x: legacy.x,
              y: legacy.y,
            })
          : persisted,
      );
      continue;
    }
    const position = legacy ?? defaults[shot.id];
    if (!position) continue;
    nodes.push(
      await api.createCanvasNode(projectId, {
        node_type: 'shot_plan',
        ref_id: shot.id,
        x: position.x,
        y: position.y,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        z_index: shot.ordinal,
      }),
    );
  }
  if (serialized !== null) localStorage.removeItem(storageKey);
  return nodes;
}
function describeError(error: unknown): string {
  if (error instanceof api.ApiError) return `${error.message} · ${error.code}`;
  return error instanceof Error ? error.message : '画布布局加载失败';
}

export function useCanvasNodes(snapshot: ProjectSnapshot) {
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const loadKey = useMemo(
    () => `${snapshot.project.id}:${snapshot.shot_plans.map(({ id }) => id).join(',')}`,
    [snapshot.project.id, snapshot.shot_plans],
  );

  useEffect(() => {
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    setLoading(true);
    setError(null);
    let pending = pendingLoads.get(loadKey);
    if (!pending) {
      pending = loadNodes(snapshot).finally(() => pendingLoads.delete(loadKey));
      pendingLoads.set(loadKey, pending);
    }
    void pending.then(
      (loaded) => {
        if (requestId.current !== currentRequest) return;
        setNodes(loaded);
        setLoading(false);
      },
      (loadError: unknown) => {
        if (requestId.current !== currentRequest) return;
        setError(describeError(loadError));
        setLoading(false);
      },
    );
  }, [loadKey, snapshot]);

  const updateLocalNode = (
    nodeId: string,
    update: Partial<Pick<CanvasNode, 'x' | 'y' | 'z_index'>>,
  ) => {
    setNodes((current) =>
      current.map((node) => node.id === nodeId ? { ...node, ...update } : node),
    );
  };

  const persistNode = async (input: UpdateCanvasNodeInput) => {
    try {
      const updated = await api.updateCanvasNode(snapshot.project.id, input);
      setNodes((current) =>
        current.map((node) => node.id === updated.id ? updated : node),
      );
      setError(null);
    } catch (persistError) {
      setError(describeError(persistError));
    }
  };

  const placeCharacter = async (characterId: string) => {
    if (nodes.some((node) =>
      node.node_type === 'character' && node.ref_id === characterId)) return;
    try {
      const characterCount = nodes.filter(
        ({ node_type }) => node_type === 'character',
      ).length;
      const created = await api.createCanvasNode(snapshot.project.id, {
        node_type: 'character',
        ref_id: characterId,
        x: 940,
        y: 100 + characterCount * 244,
        width: 240,
        height: 220,
        z_index: Math.max(0, ...nodes.map(({ z_index }) => z_index)) + 1,
      });
      setNodes((current) => [...current, created]);
      setError(null);
    } catch (placeError) {
      setError(describeError(placeError));
    }
  };

  return { nodes, loading, error, updateLocalNode, persistNode, placeCharacter };
}
