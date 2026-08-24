import { useEffect, useMemo, useState } from 'react';
import type { GenerationPreflight, ProjectSnapshot, ShotPlan,
  UpdateCanvasNodeInput } from '@h3storyboard/protocol';
import { buildStoryboardGraph } from '../lib/storyboard-graph.js';
import { useCanvasNodes } from '../lib/use-canvas-nodes.js';
import { useCharacters } from '../lib/use-characters.js';
import { AssetLibraryPanel } from './AssetLibraryPanel.js';
import { CanvasInspectorPanel } from './CanvasInspectorPanel.js';
import { CharacterLibraryPanel } from './CharacterLibraryPanel.js';
import { StoryboardFlow } from './StoryboardFlow.js';

interface InfiniteCanvasProps {
  snapshot: ProjectSnapshot;
  selectedShotId: string | null;
  busy: boolean;
  onNewShot: () => void;
  onSelectShot: (id: string) => void;
  preflights: Map<string, GenerationPreflight>;
  onGenerate: (shot: ShotPlan, preflight: GenerationPreflight,
    reason: string | null) => Promise<boolean>;
  onSetup: () => void;
}

export function InfiniteCanvas({ snapshot, selectedShotId, busy, onNewShot,
  onSelectShot, preflights, onGenerate, onSetup }: InfiniteCanvasProps) {
  const { nodes: canvasNodes, loading, error, persistNode, placeCharacter } =
    useCanvasNodes(snapshot);
  const characterStore = useCharacters(snapshot.project.id);
  const graph = useMemo(() => buildStoryboardGraph({ snapshot, canvasNodes,
    characters: characterStore.characters }),
  [canvasNodes, characterStore.characters, snapshot]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    selectedShotId ? `shot:${selectedShotId}` : null);
  const selectedNode = graph.nodes.find(({ id }) => id === selectedNodeId) ?? null;

  useEffect(() => {
    if (!selectedShotId) return;
    setSelectedNodeId((current) => {
      const selected = graph.nodes.find(({ id }) => id === current);
      return selected?.shot_id === selectedShotId
        ? current : `shot:${selectedShotId}`;
    });
  }, [selectedShotId]);

  const persist = async (input: UpdateCanvasNodeInput) => {
    await persistNode(input);
  };

  return <div className="canvas-layout">
    <AssetLibraryPanel projectId={snapshot.project.id} />
    <StoryboardFlow key={snapshot.project.id} graph={graph} snapshot={snapshot}
      selectedNodeId={selectedNodeId} busy={busy} loading={loading} error={error}
      preflights={preflights} onNewShot={onNewShot} onGenerate={onGenerate}
      onSetup={onSetup} onPersist={persist}
      onSelect={(node) => { setSelectedNodeId(node?.id ?? null);
        if (node?.shot_id) onSelectShot(node.shot_id); }} />
    <div className="canvas-right-rail">
      <CanvasInspectorPanel node={selectedNode} snapshot={snapshot} />
      <CharacterLibraryPanel characters={characterStore.characters}
        canvasCharacterIds={new Set(canvasNodes.filter(({ node_type }) =>
          node_type === 'character').map(({ ref_id }) => ref_id))}
        busy={characterStore.busy} error={characterStore.error}
        onCreate={characterStore.create} onUpdate={characterStore.update}
        onPlace={(characterId) => void placeCharacter(characterId)} />
    </div>
  </div>;
}
