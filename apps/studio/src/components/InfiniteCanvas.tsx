import { useEffect, useMemo, useRef, useState } from 'react';
import type { Asset, BindShotReferenceInput, GenerationPreflight,
  ProjectSnapshot, ShotPlan,
  UpdateCanvasNodeInput } from '@h3storyboard/protocol';
import { buildStoryboardGraph } from '../lib/storyboard-graph.js';
import { allowsH3NativeAudio } from '../lib/h3-audio-policy.js';
import { selectApprovedRootReferences } from
  '../lib/production-board-selectors.js';
import { useCanvasNodes } from '../lib/use-canvas-nodes.js';
import { useCharacters } from '../lib/use-characters.js';
import { useBrowserFullscreen } from '../lib/use-browser-fullscreen.js';
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
  canvasFocusMode: boolean;
  onCanvasFocusModeChange: (active: boolean) => void;
  onSelectShot: (id: string) => void;
  preflights: Map<string, GenerationPreflight>;
  onGenerate: (shot: ShotPlan, preflight: GenerationPreflight,
    reason: string | null) => Promise<boolean>;
  onGenerateBatch: (shots: ShotPlan[],
    preflights: Map<string, GenerationPreflight>,
    reason: string | null) => Promise<boolean>;
  onBindReference: (shotId: string,
    input: BindShotReferenceInput) => Promise<boolean>;
  onSetup: () => void;
  onReviewActual: (actualId: string,
    verdict: 'approved' | 'rejected') => Promise<boolean>;
  onMarkRepresentative: (actualId: string,
    representative: boolean) => Promise<boolean>;
  onReviewRepresentative: (actualId: string,
    status: 'approved' | 'rejected') => Promise<boolean>;
}

export function InfiniteCanvas({ snapshot, selectedShotId, busy, onNewShot,
  canvasFocusMode, onCanvasFocusModeChange, shotFocusRevision, onSelectShot,
  preflights, onGenerate, onSetup, onReviewActual, onMarkRepresentative,
  onReviewRepresentative, onGenerateBatch,
  onBindReference }: InfiniteCanvasProps) {
  const canvasRoot = useRef<HTMLDivElement>(null);
  const fullscreen = useBrowserFullscreen();
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
  const [assetDrawerOpen, setAssetDrawerOpen] = useState(false);
  const characterReferences = useMemo(() => selectApprovedRootReferences(
    assets, characterStore.references), [assets, characterStore.references]);
  const selectedNode = graph.nodes.find(({ id }) => id === selectedNodeId) ?? null;
  const selectedNodeShot = selectedNode?.shot_id
    ? snapshot.shot_plans.find(({ id }) => id === selectedNode.shot_id) ?? null : null;
  const activeSceneId = selectedNode?.scene_id ?? selectedNode?.shot?.scene_id
    ?? selectedNodeShot?.scene_id ?? snapshot.shot_plans.find(
      ({ id }) => id === selectedShotId)?.scene_id ?? null;
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

  useEffect(() => {
    if (!canvasFocusMode) setAssetDrawerOpen(false);
  }, [canvasFocusMode]);

  const persist = async (input: UpdateCanvasNodeInput) => {
    await persistNode(input);
  };

  const focusCanvas = (controlLabel?: string) => {
    window.requestAnimationFrame(() => {
      const control = controlLabel
        ? canvasRoot.current?.querySelector<HTMLButtonElement>(
          `[aria-label="${controlLabel}"]`) : null;
      (control ?? canvasRoot.current)?.focus({ preventScroll: true });
    });
  };

  const toggleFocusMode = () => {
    if (fullscreen.busy) return;
    if (canvasFocusMode && fullscreen.active) {
      void fullscreen.toggle().then((exited) => {
        if (exited) {
          onCanvasFocusModeChange(false);
          focusCanvas();
        }
      });
      return;
    }
    setAssetDrawerOpen(false);
    if (!canvasFocusMode) setSelectedNodeId(null);
    onCanvasFocusModeChange(!canvasFocusMode);
    focusCanvas();
  };

  const toggleBrowserFullscreen = () => {
    if (!fullscreen.active) {
      setAssetDrawerOpen(false);
      setSelectedNodeId(null);
      onCanvasFocusModeChange(true);
    }
    void fullscreen.toggle();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || event.metaKey || event.ctrlKey ||
        event.altKey || document.querySelector('[role="dialog"]')) return;
      if (event.key.toLowerCase() === 'f') {
        if (fullscreen.active || fullscreen.busy) return;
        event.preventDefault();
        toggleFocusMode();
      } else if (event.key === 'Escape' && canvasFocusMode &&
        !fullscreen.active && !fullscreen.busy) {
        onCanvasFocusModeChange(false);
        focusCanvas();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canvasFocusMode, fullscreen.active, fullscreen.busy]);

  return <div className="canvas-layout" data-focus={canvasFocusMode}
    data-asset-drawer-open={canvasFocusMode && assetDrawerOpen}
    data-inspector-drawer-open={canvasFocusMode && !assetDrawerOpen &&
      selectedNode !== null} ref={canvasRoot} tabIndex={-1}>
    <AssetLibraryPanel projectId={snapshot.project.id}
      forceOpen={assetDrawerOpen}
      onClose={() => { setAssetDrawerOpen(false);
        focusCanvas('打开资产抽屉'); }} />
    <StoryboardFlow key={snapshot.project.id} graph={graph} snapshot={graphSnapshot}
      selectedNodeId={selectedNodeId} busy={busy} loading={loading} error={error}
      focusRevision={shotFocusRevision} activeSceneId={activeSceneId}
      focusMode={canvasFocusMode} browserFullscreen={fullscreen.active}
      browserFullscreenBusy={fullscreen.busy}
      assetDrawerOpen={assetDrawerOpen}
      preflights={preflights} characterReferences={characterReferences}
      onNewShot={onNewShot} onGenerate={onGenerate} onSetup={onSetup}
      onGenerateBatch={onGenerateBatch} onBindReference={onBindReference}
      onToggleAssetDrawer={() => { setAssetDrawerOpen(!assetDrawerOpen);
        if (assetDrawerOpen) focusCanvas('打开资产抽屉'); }}
      onToggleFocusMode={toggleFocusMode}
      onToggleBrowserFullscreen={toggleBrowserFullscreen}
      onOpenMedia={setLightboxAssetId} onPersist={persist}
      onSelect={(node) => { setSelectedNodeId(node?.id ?? null);
        if (node) setAssetDrawerOpen(false);
        if (node?.shot_id) onSelectShot(node.shot_id); }} />
    <div className="canvas-right-rail">
      <CanvasInspectorPanel node={selectedNode} snapshot={graphSnapshot} assets={assets}
        busy={busy}
        characterReference={selectedCharacterReference}
        {...(canvasFocusMode ? { onClose: () => { setSelectedNodeId(null);
          focusCanvas('聚焦当前场景'); } } : {})}
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
    {fullscreen.error ? <div className="canvas-status" role="alert">
      {fullscreen.error}</div> : null}
    {lightboxAsset ? <MediaLightbox asset={lightboxAsset}
      audioAllowed={allowsH3NativeAudio(lightboxAsset, snapshot.h3_jobs)}
      onClose={() => setLightboxAssetId(null)} /> : null}
  </div>;
}

function mergeAssets(snapshotAssets: Asset[], referenceAssets: Asset[]): Asset[] {
  const byId = new Map(snapshotAssets.map((asset) => [asset.id, asset]));
  for (const asset of referenceAssets) byId.set(asset.id, asset);
  return [...byId.values()];
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable);
}
