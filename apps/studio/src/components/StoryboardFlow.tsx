import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  BindShotReferenceInput,
  CharacterReference,
  GenerationPreflight,
  ProjectSnapshot,
  ShotPlan,
  UpdateCanvasNodeInput,
} from '@h3storyboard/protocol';
import {
  type ReactFlowInstance,
  type Viewport,
  useNodesState,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react';
import type { StoryboardGraph, StoryboardViewNode } from '../lib/storyboard-graph.js';
import { selectCanvasFocusNodeId } from '../lib/storyboard-focus.js';
import { buildShotBinding, type ShotBindingTarget } from '../lib/storyboard-binding.js';
import { isolateStoryboardScene, listStoryboardScenes } from
  '../lib/storyboard-scene-director.js';
import { projectStoryboardEdges, projectStoryboardNodes } from
  './storyboard-flow-projection.js';
import { StoryboardFlowSurface } from './StoryboardFlowSurface.js';
import type { StoryboardFlowNode } from './storyboard-flow-types.js';
import { useStoryboardNodeDrag } from './use-storyboard-node-drag.js';
import { useStoryboardSelection } from './use-storyboard-selection.js';

interface StoryboardFlowProps {
  graph: StoryboardGraph;
  snapshot: ProjectSnapshot;
  selectedNodeId: string | null;
  activeSceneId: string | null;
  focusRevision: number;
  focusMode: boolean;
  browserFullscreen: boolean;
  browserFullscreenBusy: boolean;
  assetDrawerOpen: boolean;
  busy: boolean;
  loading: boolean;
  error: string | null;
  preflights: Map<string, GenerationPreflight>;
  characterReferences: Map<string, CharacterReference>;
  onSelect: (node: StoryboardViewNode | null) => void;
  onGenerate: (shot: ShotPlan, preflight: GenerationPreflight,
    reason: string | null) => Promise<boolean>;
  onGenerateBatch: (shots: ShotPlan[], preflights: Map<string, GenerationPreflight>,
    reason: string | null) => Promise<boolean>;
  onBindReference: (shotId: string, input: BindShotReferenceInput) => Promise<boolean>;
  onSetup: () => void;
  onOpenMedia: (assetId: string) => void;
  onToggleAssetDrawer: () => void;
  onToggleFocusMode: () => void;
  onToggleBrowserFullscreen: () => void;
  onPersist: (input: UpdateCanvasNodeInput) => Promise<void>;
}

const NO_PENDING_SCENE = Symbol('no-pending-scene');
export function StoryboardFlow({ graph, snapshot, selectedNodeId, busy,
  activeSceneId, focusRevision, focusMode, browserFullscreen,
  browserFullscreenBusy, assetDrawerOpen,
  loading, error, preflights, characterReferences, onSelect, onGenerate, onSetup,
  onGenerateBatch, onBindReference,
  onOpenMedia, onToggleAssetDrawer, onToggleFocusMode,
  onToggleBrowserFullscreen, onPersist }: StoryboardFlowProps) {
  const scenes = useMemo(() => listStoryboardScenes(graph), [graph]);
  const [isolatedSceneId, setIsolatedSceneId] = useState<string | null>(null);
  const displayedGraph = useMemo(() => isolatedSceneId
    ? isolateStoryboardScene(graph, isolatedSceneId) : graph,
  [graph, isolatedSceneId]);
  const projectedNodes = useMemo(() => projectStoryboardNodes({
    graph: displayedGraph, snapshot, selectedNodeId: null, busy,
    directorMode: isolatedSceneId !== null, preflights, characterReferences,
    onGenerate, onSetup, onOpenMedia,
  }), [busy, characterReferences, displayedGraph, isolatedSceneId, onGenerate,
    onOpenMedia, onSetup, preflights, snapshot]);
  const [nodes, setNodes, onNodesChange] = useNodesState(projectedNodes);
  const selection = useStoryboardSelection({ setNodes,
    shots: snapshot.shot_plans, onSelect });
  const [fitRevision, setFitRevision] = useState(0);
  const edges = useMemo(() => projectStoryboardEdges(displayedGraph),
    [displayedGraph]);
  const flowInstance = useRef<ReactFlowInstance<StoryboardFlowNode, Edge> | null>(
    null);
  const fittedTarget = useRef('');
  const activeSceneIdRef = useRef(activeSceneId);
  const selectedNodeIdRef = useRef(selectedNodeId);
  const pendingSceneRestore = useRef<string | null | symbol>(NO_PENDING_SCENE);
  const sceneViewports = useRef(new Map<string | null, Viewport>());
  const cameraMovementRevision = useRef(0);
  const handledFocusRevision = useRef(focusRevision);
  activeSceneIdRef.current = activeSceneId;
  selectedNodeIdRef.current = selectedNodeId;
  const sceneKey = isolatedSceneId;
  const sceneTargetKey = sceneKey === null ? 'overview' : `scene:${sceneKey}`;
  const sceneKeyRef = useRef<string | null>(sceneKey);
  sceneKeyRef.current = sceneKey;

  const fitOverview = (duration = 220): Promise<boolean> => {
    return flowInstance.current?.fitView({ padding: isolatedSceneId ? 0.07 : 0.12,
      minZoom: isolatedSceneId ? 0.5 : 0.18,
      maxZoom: 0.9, duration }) ?? Promise.resolve(false);
  };

  const fitFocusTarget = (targetId: string | null,
    duration = 220): Promise<boolean> => {
    const instance = flowInstance.current;
    const target = targetId ? instance?.getNode(targetId) : null;
    if (!instance || !target) return fitOverview(duration);
    return instance.fitView({ nodes: [target], padding: 0.16,
      minZoom: 0.46, maxZoom: 1.05, duration });
  };
  const drag = useStoryboardNodeDrag({ projectedNodes, setNodes, onPersist,
    onDeferredFit: () => setFitRevision((value) => value + 1) });

  const selectScene = (nextSceneId: string | null) => {
    if (nextSceneId === isolatedSceneId) {
      trackCameraMovement(sceneKey, fitOverview());
      return;
    }
    const viewport = flowInstance.current?.getViewport();
    if (viewport) sceneViewports.current.set(sceneKey, viewport);
    pendingSceneRestore.current = nextSceneId;
    fittedTarget.current = '';
    setIsolatedSceneId(nextSceneId);
    selection.clearSelection();
  };

  useEffect(() => {
    if (loading || displayedGraph.nodes.length === 0) return;
    const modeTarget = isolatedSceneId === null
      ? `${focusMode}:${browserFullscreen}` : 'scene-camera';
    const target = `${sceneTargetKey}:${fitRevision}:${focusRevision}:${modeTarget}`;
    if (fittedTarget.current === target) return;
    const frame = window.requestAnimationFrame(() => {
      if (drag.deferFitIfDragging()) return;
      fittedTarget.current = target;
      if (pendingSceneRestore.current !== NO_PENDING_SCENE &&
        pendingSceneRestore.current === sceneKey) {
        const viewport = sceneViewports.current.get(sceneKey);
        pendingSceneRestore.current = NO_PENDING_SCENE;
        const movement = viewport
          ? flowInstance.current?.setViewport(viewport, { duration: 0 }) ??
            Promise.resolve(false)
          : fitOverview();
        trackCameraMovement(sceneKey, movement);
        return;
      }
      const selectedId = focusMode ? null : selectedNodeIdRef.current;
      trackCameraMovement(sceneKey, fitFocusTarget(selectCanvasFocusNodeId(
        displayedGraph.nodes, selectedId, activeSceneIdRef.current),
      selectedId ? 0 : 220));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [browserFullscreen, displayedGraph.nodes, fitRevision, focusMode,
    focusRevision, loading, sceneKey, sceneTargetKey]);

  useEffect(() => {
    if (handledFocusRevision.current === focusRevision) return;
    handledFocusRevision.current = focusRevision;
    selection.clearShotSelection();
    if (!isolatedSceneId || !activeSceneId ||
      isolatedSceneId === activeSceneId) return;
    const viewport = flowInstance.current?.getViewport();
    if (viewport) sceneViewports.current.set(sceneKey, viewport);
    pendingSceneRestore.current = activeSceneId;
    fittedTarget.current = '';
    setIsolatedSceneId(activeSceneId);
  }, [activeSceneId, focusRevision, isolatedSceneId, sceneKey]);

  const onNodeClick: NodeMouseHandler<StoryboardFlowNode> = (_event, node) => {
    onSelect(node.data.view);
  };

  const resolveBinding = (connection: { source: string | null;
    sourceHandle?: string | null; target: string | null;
    targetHandle?: string | null }) => {
    const sourceNode = nodes.find(({ id }) => id === connection.source);
    const targetNode = nodes.find(({ id }) => id === connection.target);
    const source = sourceNode?.data.bindingSources.find(
      ({ handle_id }) => handle_id === connection.sourceHandle);
    const purpose = connection.targetHandle?.startsWith('target:')
      ? connection.targetHandle.slice(7) as ShotBindingTarget : null;
    return source && purpose && targetNode?.data.view.shot
      ? { shot: targetNode.data.view.shot,
        input: buildShotBinding(source, purpose, targetNode.data.view.shot.id) }
      : null;
  };

  function trackCameraMovement(key: string | null,
    movement: Promise<boolean>): void {
    cameraMovementRevision.current += 1;
    const revision = cameraMovementRevision.current;
    void movement.finally(() => {
      if (cameraMovementRevision.current !== revision ||
        sceneKeyRef.current !== key) return;
      const viewport = flowInstance.current?.getViewport();
      if (viewport) sceneViewports.current.set(key, viewport);
    });
  }

  return <StoryboardFlowSurface graph={graph} snapshot={snapshot} scenes={scenes}
    isolatedSceneId={isolatedSceneId} activeSceneId={activeSceneId}
    focusMode={focusMode} browserFullscreen={browserFullscreen}
    browserFullscreenBusy={browserFullscreenBusy} assetDrawerOpen={assetDrawerOpen}
    loading={loading} error={error} busy={busy} selectedShots={selection.selectedShots}
    preflights={preflights} onSelectScene={selectScene}
    onClearSelection={selection.clearSelection}
    onGenerateBatch={onGenerateBatch} onSetup={onSetup}
    onToggleAssetDrawer={onToggleAssetDrawer}
    onToggleFocusMode={onToggleFocusMode}
    onToggleBrowserFullscreen={onToggleBrowserFullscreen}
    flowProps={{ nodes, edges,
      onInit: (instance) => { flowInstance.current = instance; },
      onNodesChange,
      onMoveEnd: (_event, viewport) => {
        sceneViewports.current.set(sceneKeyRef.current, viewport);
      },
      onNodeClick,
      onPaneClick: selection.clearSelection,
      onSelectionChange: ({ nodes: selected }) =>
        selection.updateSelectedShots(selected),
      onConnect: (connection) => {
        if (busy) return;
        const binding = resolveBinding(connection);
        if (binding?.input) void onBindReference(binding.shot.id, binding.input);
      },
      isValidConnection: (connection) => !busy &&
        Boolean(resolveBinding(connection)?.input),
      onNodeDragStart: drag.onNodeDragStart,
      onNodeDragStop: drag.onNodeDragStop,
      fitView: true,
      fitViewOptions: { padding: 0.12, minZoom: 0.18, maxZoom: 0.9 },
      minZoom: 0.18, maxZoom: 2.4, onlyRenderVisibleElements: true,
      nodesConnectable: isolatedSceneId !== null && !busy,
      edgesReconnectable: false,
      deleteKeyCode: null, selectionKeyCode: 'Shift',
      multiSelectionKeyCode: ['Meta', 'Control'],
      zoomOnDoubleClick: false, panOnScroll: true, panOnDrag: [0, 1],
      colorMode: 'dark', defaultEdgeOptions: { selectable: false },
    }} />;
}
