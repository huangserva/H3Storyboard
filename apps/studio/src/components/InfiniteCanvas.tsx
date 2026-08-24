import { useEffect, useMemo, useState } from 'react';
import type { Asset, GenerationPreflight, ProjectSnapshot, ShotPlan,
  UpdateCanvasNodeInput } from '@h3storyboard/protocol';
import { buildStoryboardGraph } from '../lib/storyboard-graph.js';
import { selectApprovedRootReferences } from
  '../lib/production-board-selectors.js';
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
  const assets = useMemo(() => mergeAssets(
    snapshot.assets, characterStore.referenceAssets),
  [snapshot.assets, characterStore.referenceAssets]);
  const graphSnapshot = useMemo(() => ({ ...snapshot, assets }), [assets, snapshot]);
  const graph = useMemo(() => buildStoryboardGraph({ snapshot: graphSnapshot,
    canvasNodes, characters: characterStore.characters,
    characterReferences: characterStore.references,
    characterAssetDerivations: characterStore.assetDerivations }),
  [canvasNodes, characterStore.assetDerivations, characterStore.characters,
    characterStore.references, graphSnapshot]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    selectedShotId ? `shot:${selectedShotId}` : null);
  const [lightboxAssetId, setLightboxAssetId] = useState<string | null>(null);
  const characterReferences = useMemo(() => selectApprovedRootReferences(
    assets, characterStore.references), [assets, characterStore.references]);
  const selectedNode = graph.nodes.find(({ id }) => id === selectedNodeId) ?? null;
  const selectedCharacterReference = selectedNode?.character
    ? characterReferences.get(selectedNode.character.id) ?? null : null;
  const lightboxAsset = lightboxAssetId
    ? assets.find(({ id }) => id === lightboxAssetId) ?? null : null;

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
    <StoryboardFlow key={snapshot.project.id} graph={graph} snapshot={graphSnapshot}
      selectedNodeId={selectedNodeId} busy={busy} loading={loading} error={error}
      focusRevision={shotFocusRevision}
      preflights={preflights} characterReferences={characterReferences}
      onNewShot={onNewShot} onGenerate={onGenerate} onSetup={onSetup}
      onOpenMedia={setLightboxAssetId} onPersist={persist}
      onSelect={(node) => { setSelectedNodeId(node?.id ?? null);
        if (node?.shot_id) onSelectShot(node.shot_id); }} />
    <div className="canvas-right-rail">
      <CanvasInspectorPanel node={selectedNode} snapshot={graphSnapshot} assets={assets}
        busy={busy}
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

function mergeAssets(snapshotAssets: Asset[], referenceAssets: Asset[]): Asset[] {
  const byId = new Map(snapshotAssets.map((asset) => [asset.id, asset]));
  for (const asset of referenceAssets) byId.set(asset.id, asset);
  return [...byId.values()];
}
