import type { StoryboardViewNode } from './storyboard-graph-types.js';

export function selectCanvasFocusNodeId(
  nodes: StoryboardViewNode[],
  selectedNodeId: string | null,
  activeSceneId: string | null,
): string | null {
  const selected = selectedNodeId
    ? nodes.find(({ id }) => id === selectedNodeId) ?? null : null;
  if (selected?.kind === 'scene') return selected.id;
  if (selected && selected.kind !== 'shot') return selected.id;

  const sceneId = selected?.scene_id ?? selected?.shot?.scene_id ?? activeSceneId;
  if (sceneId) {
    const scene = nodes.find((candidate) => candidate.kind === 'scene' &&
      candidate.entity_id === sceneId);
    if (scene) return scene.id;
  }
  return selected?.id ?? null;
}
