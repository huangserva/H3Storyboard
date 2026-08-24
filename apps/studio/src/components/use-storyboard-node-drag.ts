import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { UpdateCanvasNodeInput } from '@h3storyboard/protocol';
import type { OnNodeDrag } from '@xyflow/react';
import type { StoryboardFlowNode } from './storyboard-flow-types.js';

interface StoryboardNodeDragInput {
  projectedNodes: StoryboardFlowNode[];
  setNodes: Dispatch<SetStateAction<StoryboardFlowNode[]>>;
  onPersist: (input: UpdateCanvasNodeInput) => Promise<void>;
  onDeferredFit: () => void;
}

export function useStoryboardNodeDrag({ projectedNodes, setNodes, onPersist,
  onDeferredFit }: StoryboardNodeDragInput) {
  const sessions = useRef(new Map<string, number>());
  const starts = useRef(new Map<string, { x: number; y: number }>());
  const nextSession = useRef(0);
  const pendingFit = useRef(false);
  const latestProjectedNodes = useRef(projectedNodes);
  latestProjectedNodes.current = projectedNodes;

  useEffect(() => setNodes((current) => {
    const currentById = new Map(current.map((node) => [node.id, node]));
    return projectedNodes.map((node) => {
      const dragged = currentById.get(node.id);
      return sessions.current.has(node.id) && dragged
        ? { ...node, position: dragged.position,
          dragging: dragged.dragging ?? false }
        : node;
    });
  }), [projectedNodes, setNodes]);

  const onNodeDragStart: OnNodeDrag<StoryboardFlowNode> = (_event, node) => {
    nextSession.current += 1;
    sessions.current.set(node.id, nextSession.current);
    starts.current.set(node.id, node.position);
  };

  const onNodeDragStop: OnNodeDrag<StoryboardFlowNode> = (_event, node) => {
    const persistedId = node.data.view.persisted_node_id;
    const session = sessions.current.get(node.id);
    const start = starts.current.get(node.id);
    if (!persistedId || session === undefined || !start) {
      clear(node.id);
      return;
    }
    void onPersist({ node_id: persistedId, x: node.position.x,
      y: node.position.y, z_index: node.data.view.z_index })
      .catch(() => {
        if (sessions.current.get(node.id) !== session) return;
        restoreLatestProjection(node.id, start);
      })
      .finally(() => {
        if (sessions.current.get(node.id) !== session) return;
        clear(node.id);
        restoreLatestProjection(node.id, start);
        if (pendingFit.current) {
          pendingFit.current = false;
          onDeferredFit();
        }
      });
  };

  const deferFitIfDragging = (): boolean => {
    if (sessions.current.size === 0) return false;
    pendingFit.current = true;
    return true;
  };

  function clear(nodeId: string): void {
    sessions.current.delete(nodeId);
    starts.current.delete(nodeId);
  }

  function restoreLatestProjection(nodeId: string,
    fallback: { x: number; y: number }): void {
    const projected = latestProjectedNodes.current.find(({ id }) => id === nodeId);
    setNodes((current) => current.map((candidate) => candidate.id === nodeId
      ? { ...candidate, position: projected?.position ?? fallback,
        dragging: false }
      : candidate));
  }

  return { deferFitIfDragging, onNodeDragStart, onNodeDragStop };
}
