import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CanvasNode,
  ProjectSnapshot,
  UpdateCanvasNodeInput,
} from '@h3storyboard/protocol';
import { createInitialPositions, parseStoredPositions } from './canvas-layout.js';
import * as api from './api.js';
import { KeyedSerialQueue } from './keyed-serial-queue.js';
import { SharedRequestRegistry } from './shared-request-registry.js';

const CARD_WIDTH = 260;
const CARD_HEIGHT = 196;
const canvasLoads = new SharedRequestRegistry<CanvasNode[]>();

async function loadNodes(snapshot: ProjectSnapshot,
  signal: AbortSignal): Promise<CanvasNode[]> {
  const projectId = snapshot.project.id;
  const storageKey = `h3storyboard.canvas.v1.${projectId}`;
  const serialized = localStorage.getItem(storageKey);
  const stored = parseStoredPositions(serialized);
  const defaults = createInitialPositions(snapshot.shot_plans);
  const nodes = snapshot.shot_plans.flatMap((shot) => {
    const legacy = stored[shot.id];
    const position = legacy ?? defaults[shot.id];
    return position ? [{
        node_type: 'shot_plan',
        ref_id: shot.id,
        x: position.x,
        y: position.y,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        z_index: shot.ordinal,
        update_position_if_untouched: legacy !== undefined,
      } as const] : [];
  });
  const result = await api.batchUpsertCanvasNodes(projectId, { nodes }, signal);
  if (serialized !== null) localStorage.removeItem(storageKey);
  return result.canvas_nodes;
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
  const persistQueue = useRef(new KeyedSerialQueue<string>());
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const loadKey = useMemo(
    () => `${snapshot.project.id}:${snapshot.shot_plans.map(({ id }) => id).join(',')}`,
    [snapshot.project.id, snapshot.shot_plans],
  );

  useEffect(() => {
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    setLoading(true);
    setError(null);
    let active = true;
    const lease = canvasLoads.acquire(loadKey, (signal) =>
      loadNodes(snapshotRef.current, signal));
    void lease.promise.then(
      (loaded) => {
        if (!active || requestId.current !== currentRequest) return;
        setNodes(loaded);
        setLoading(false);
      },
      (loadError: unknown) => {
        if (!active || isAbortError(loadError) ||
          requestId.current !== currentRequest) return;
        setError(describeError(loadError));
        setLoading(false);
      },
    );
    return () => { active = false; lease.release(); };
  }, [loadKey]);

  const updateLocalNode = (
    nodeId: string,
    update: Partial<Pick<CanvasNode, 'x' | 'y' | 'z_index'>>,
  ) => {
    setNodes((current) =>
      current.map((node) => node.id === nodeId ? { ...node, ...update } : node),
    );
  };

  const persistNode = (input: UpdateCanvasNodeInput) =>
    persistQueue.current.run(input.node_id, async () => {
      try {
        const updated = await api.updateCanvasNode(snapshot.project.id, input);
        setNodes((current) =>
          current.map((node) => node.id === updated.id ? updated : node),
        );
        setError(null);
      } catch (persistError) {
        setError(describeError(persistError));
        throw persistError;
      }
    });

  const placeCharacter = async (characterId: string) => {
    if (nodes.some((node) =>
      node.node_type === 'character' && node.ref_id === characterId)) return;
    try {
      const characterCount = nodes.filter(
        ({ node_type }) => node_type === 'character',
      ).length;
      const result = await api.batchUpsertCanvasNodes(snapshot.project.id, {
        nodes: [{ node_type: 'character', ref_id: characterId, x: 640,
          y: 100 + characterCount * 244, width: 240, height: 220,
          z_index: Math.max(0, ...nodes.map(({ z_index }) => z_index)) + 1 }],
      });
      const placed = result.canvas_nodes.find(({ node_type, ref_id }) =>
        node_type === 'character' && ref_id === characterId);
      if (!placed) throw new Error('Character canvas node was not returned');
      setNodes((current) => current.some(({ id }) => id === placed.id)
        ? current : [...current, placed]);
      setError(null);
    } catch (placeError) {
      setError(describeError(placeError));
    }
  };

  return { nodes, loading, error, updateLocalNode, persistNode, placeCharacter };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
