import { useState, type Dispatch, type SetStateAction } from 'react';
import type { ShotPlan } from '@h3storyboard/protocol';
import type { StoryboardViewNode } from '../lib/storyboard-graph.js';
import type { StoryboardFlowNode } from './storyboard-flow-types.js';

interface SelectionInput {
  setNodes: Dispatch<SetStateAction<StoryboardFlowNode[]>>;
  shots: ShotPlan[];
  onSelect: (node: StoryboardViewNode | null) => void;
}

export function useStoryboardSelection({ setNodes, shots,
  onSelect }: SelectionInput) {
  const [selectedShotNodeIds, setSelectedShotNodeIds] = useState<Set<string>>(
    new Set());
  const selectedShots = shots.filter((shot) =>
    selectedShotNodeIds.has(`shot:${shot.id}`))
    .sort((left, right) => left.ordinal - right.ordinal);

  const updateSelectedShots = (selected: StoryboardFlowNode[]) => {
    const next = new Set(selected.filter(({ data }) => data.view.kind === 'shot')
      .map(({ id }) => id));
    setSelectedShotNodeIds((current) => current.size === next.size &&
      [...current].every((id) => next.has(id)) ? current : next);
  };
  const clearShotSelection = () => {
    setNodes((current) => current.map((node) => node.selected
      ? { ...node, selected: false } : node));
    setSelectedShotNodeIds(new Set());
  };
  const clearSelection = () => {
    clearShotSelection();
    onSelect(null);
  };
  return { selectedShots, updateSelectedShots, clearShotSelection,
    clearSelection };
}
