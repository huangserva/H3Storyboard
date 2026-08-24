import { useEffect, useMemo, useState } from 'react';
import type { CharacterReference, GenerationPreflight, ProjectSnapshot, ShotPlan,
  UpdateCanvasNodeInput } from '@h3storyboard/protocol';
import { buildStoryboardGraph } from '../lib/storyboard-graph.js';
import { useCanvasNodes } from '../lib/use-canvas-nodes.js';
import { useCharacters } from '../lib/use-characters.js';
import { AssetLibraryPanel } from './AssetLibraryPanel.js';
import { CanvasInspectorPanel } from './CanvasInspectorPanel.js';
import { CharacterLibraryPanel } from './CharacterLibraryPanel.js';
import { MediaLightbox } from './MediaLightbox.js';
import { StoryboardFlow } from './StoryboardFlow.js';

interface InfiniteCanvasProps {
  snapshot: ProjectSnapshot;
  selectedShotId: string | null;
  shotFocusRevision: number;
  busy: boolean;
  onNewShot: () => void;
  onSelectShot: (id: string) => void;
  preflights: Map<string, GenerationPreflight>;
  onGenerate: (shot: ShotPlan, preflight: GenerationPreflight,
    reason: string | null) => Promise<boolean>;
  onSetup: () => void;
  onReviewActual: (actualId: string,
    verdict: 'approved' | 'rejected') => Promise<boolean>;
  onMarkRepresentative: (actualId: string,
    representative: boolean) => Promise<boolean>;
  onReviewRepresentative: (actualId: string,
    status: 'approved' | 'rejected') => Promise<boolean>;
}

export function InfiniteCanvas({ snapshot, selectedShotId, busy, onNewShot,
  shotFocusRevision, onSelectShot, preflights, onGenerate, onSetup, onReviewActual,
  onMarkRepresentative, onReviewRepresentative }: InfiniteCanvasProps) {
  const { nodes: canvasNodes, loading, error, persistNode, placeCharacter } =
    useCanvasNodes(snapshot);
  const characterStore = useCharacters(snapshot.project.id);
  const graph = useMemo(() => buildStoryboardGraph({ snapshot, canvasNodes,
    characters: characterStore.characters }),
  [canvasNodes, characterStore.characters, snapshot]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    selectedShotId ? `shot:${selectedShotId}` : null);
  const [lightboxAssetId, setLightboxAssetId] = useState<string | null>(null);
  const characterReferences = useMemo(() => {
    const approvedAssets = new Set(snapshot.assets.filter(
      ({ status }) => status === 'approved').map(({ id }) => id));
    const selected = new Map<string, CharacterReference>();
    for (const reference of [...characterStore.references].sort(
      (left, right) => left.sort_order - right.sort_order)) {
      if (reference.kind !== 'image' || !reference.asset_id ||
        !approvedAssets.has(reference.asset_id) || selected.has(reference.character_id)) continue;
      selected.set(reference.character_id, reference);
    }
    return selected;
  }, [characterStore.references, snapshot.assets]);
  const selectedNode = graph.nodes.find(({ id }) => id === selectedNodeId) ?? null;
  const selectedCharacterReference = selectedNode?.character
    ? characterReferences.get(selectedNode.character.id) ?? null : null;
  const lightboxAsset = lightboxAssetId
    ? snapshot.assets.find(({ id }) => id === lightboxAssetId) ?? null : null;

  useEffect(() => {
    if (!selectedShotId) return;
    setSelectedNodeId((current) => {
      const selected = graph.nodes.find(({ id }) => id === current);
      return selected?.shot_id === selectedShotId
        ? current : `shot:${selectedShotId}`;
    });
  }, [selectedShotId]);

  useEffect(() => {
    if (selectedShotId) setSelectedNodeId(`shot:${selectedShotId}`);
  }, [shotFocusRevision]);

  useEffect(() => setLightboxAssetId(null), [snapshot.project.id]);

  const persist = async (input: UpdateCanvasNodeInput) => {
    await persistNode(input);
  };

  return <div className="canvas-layout">
    <AssetLibraryPanel projectId={snapshot.project.id} />
    <StoryboardFlow key={snapshot.project.id} graph={graph} snapshot={snapshot}
      selectedNodeId={selectedNodeId} busy={busy} loading={loading} error={error}
      focusRevision={shotFocusRevision}
      preflights={preflights} characterReferences={characterReferences}
      onNewShot={onNewShot} onGenerate={onGenerate} onSetup={onSetup}
      onOpenMedia={setLightboxAssetId} onPersist={persist}
      onSelect={(node) => { setSelectedNodeId(node?.id ?? null);
        if (node?.shot_id) onSelectShot(node.shot_id); }} />
    <div className="canvas-right-rail">
      <CanvasInspectorPanel node={selectedNode} snapshot={snapshot} busy={busy}
        characterReference={selectedCharacterReference}
        onOpenMedia={setLightboxAssetId} onReviewActual={onReviewActual}
        onMarkRepresentative={onMarkRepresentative}
        onReviewRepresentative={onReviewRepresentative} />
      <CharacterLibraryPanel characters={characterStore.characters}
        canvasCharacterIds={new Set(canvasNodes.filter(({ node_type }) =>
          node_type === 'character').map(({ ref_id }) => ref_id))}
        busy={characterStore.busy} error={characterStore.error}
        onCreate={characterStore.create} onUpdate={characterStore.update}
        onPlace={(characterId) => void placeCharacter(characterId)} />
    </div>
    {lightboxAsset ? <MediaLightbox asset={lightboxAsset}
      onClose={() => setLightboxAssetId(null)} /> : null}
  </div>;
}
