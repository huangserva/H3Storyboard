import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CharacterReference,
  GenerationPreflight,
  ProjectSnapshot,
  ShotPlan,
  UpdateCanvasNodeInput,
} from '@h3storyboard/protocol';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  type ReactFlowInstance,
  type Viewport,
  useNodesState,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react';
import type {
  StoryboardGraph,
  StoryboardViewNode,
} from '../lib/storyboard-graph.js';
import { selectCanvasFocusNodeId } from '../lib/storyboard-focus.js';
import { isolateStoryboardScene, listStoryboardScenes } from
  '../lib/storyboard-scene-director.js';
import { CanvasFlowNode } from './CanvasFlowNode.js';
import { CanvasViewportToolbar } from './CanvasViewportToolbar.js';
import { SceneCanvasNavigator } from './SceneCanvasNavigator.js';
import { minimapColor, projectStoryboardEdges, projectStoryboardNodes } from
  './storyboard-flow-projection.js';
import type { StoryboardFlowNode } from './storyboard-flow-types.js';
import { useStoryboardNodeDrag } from './use-storyboard-node-drag.js';

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
  onNewShot: () => void;
  onSelect: (node: StoryboardViewNode | null) => void;
  onGenerate: (shot: ShotPlan, preflight: GenerationPreflight,
    reason: string | null) => Promise<boolean>;
  onSetup: () => void;
  onOpenMedia: (assetId: string) => void;
  onToggleAssetDrawer: () => void;
  onToggleFocusMode: () => void;
  onToggleBrowserFullscreen: () => void;
  onPersist: (input: UpdateCanvasNodeInput) => Promise<void>;
}

const nodeTypes = { storyboard: CanvasFlowNode };
const NO_PENDING_SCENE = Symbol('no-pending-scene');

export function StoryboardFlow({ graph, snapshot, selectedNodeId, busy,
  activeSceneId, focusRevision, focusMode, browserFullscreen,
  browserFullscreenBusy, assetDrawerOpen,
  loading, error, preflights, characterReferences, onSelect, onGenerate, onSetup,
  onNewShot, onOpenMedia, onToggleAssetDrawer, onToggleFocusMode,
  onToggleBrowserFullscreen, onPersist }: StoryboardFlowProps) {
  const scenes = useMemo(() => listStoryboardScenes(graph), [graph]);
  const [isolatedSceneId, setIsolatedSceneId] = useState<string | null>(null);
  const displayedGraph = useMemo(() => isolatedSceneId
    ? isolateStoryboardScene(graph, isolatedSceneId) : graph,
  [graph, isolatedSceneId]);
  const projectedNodes = useMemo(() => projectStoryboardNodes({
    graph: displayedGraph, snapshot, selectedNodeId, busy,
    directorMode: isolatedSceneId !== null, preflights, characterReferences,
    onGenerate, onSetup, onOpenMedia,
  }), [busy, characterReferences, displayedGraph, isolatedSceneId, onGenerate,
    onOpenMedia, onSetup, preflights, selectedNodeId, snapshot]);
  const [nodes, setNodes, onNodesChange] = useNodesState(projectedNodes);
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
  const programmaticCameraBusy = useRef(false);
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
    if (viewport && !programmaticCameraBusy.current) {
      sceneViewports.current.set(sceneKey, viewport);
    }
    pendingSceneRestore.current = nextSceneId;
    fittedTarget.current = '';
    setIsolatedSceneId(nextSceneId);
    onSelect(null);
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
    if (!isolatedSceneId || !activeSceneId ||
      isolatedSceneId === activeSceneId) return;
    const viewport = flowInstance.current?.getViewport();
    if (viewport && !programmaticCameraBusy.current) {
      sceneViewports.current.set(sceneKey, viewport);
    }
    pendingSceneRestore.current = activeSceneId;
    fittedTarget.current = '';
    setIsolatedSceneId(activeSceneId);
  }, [activeSceneId, focusRevision, isolatedSceneId, sceneKey]);

  const onNodeClick: NodeMouseHandler<StoryboardFlowNode> = (_event, node) => {
    onSelect(node.data.view);
  };

  function trackCameraMovement(key: string | null,
    movement: Promise<boolean>): void {
    cameraMovementRevision.current += 1;
    const revision = cameraMovementRevision.current;
    programmaticCameraBusy.current = true;
    void movement.finally(() => {
      if (cameraMovementRevision.current !== revision ||
        sceneKeyRef.current !== key) return;
      programmaticCameraBusy.current = false;
      const viewport = flowInstance.current?.getViewport();
      if (viewport) sceneViewports.current.set(key, viewport);
    });
  }

  return <div className="storyboard-flow" data-empty={graph.nodes.length <= 1}
    data-scene-isolated={isolatedSceneId ?? 'all'}>
    <ReactFlow<StoryboardFlowNode, Edge> nodes={nodes} edges={edges}
      onInit={(instance) => { flowInstance.current = instance; }}
      nodeTypes={nodeTypes} onNodesChange={onNodesChange}
      onMoveEnd={(_event, viewport) => {
        sceneViewports.current.set(sceneKeyRef.current, viewport);
      }}
      onNodeClick={onNodeClick} onPaneClick={() => onSelect(null)}
      onNodeDragStart={drag.onNodeDragStart}
      onNodeDragStop={drag.onNodeDragStop}
      fitView fitViewOptions={{ padding: 0.12, minZoom: 0.18, maxZoom: 0.9 }}
      minZoom={0.18} maxZoom={2.4} onlyRenderVisibleElements
      nodesConnectable={false} edgesReconnectable={false}
      deleteKeyCode={null} selectionKeyCode={null}
      zoomOnDoubleClick={false} panOnScroll panOnDrag={[0, 1]}
      colorMode="dark" defaultEdgeOptions={{ selectable: false }}>
      <Background variant={BackgroundVariant.Dots} gap={24} size={1.1}
        color="rgba(238,234,222,.16)" />
      <Controls position="bottom-left" showInteractive={false} />
      <MiniMap position="bottom-right" pannable zoomable nodeStrokeWidth={2}
        nodeColor={(node) => minimapColor(
          (node as StoryboardFlowNode).data.view.kind)} />
      <Panel position="top-left" className="flow-toolbar canvas-context-bar">
        <SceneCanvasNavigator scenes={scenes} activeSceneId={isolatedSceneId}
          onSelectScene={selectScene} />
      </Panel>
      <Panel position="top-right">
        <CanvasViewportToolbar sceneLabel={isolatedSceneId ??
          activeSceneId ?? 'ALL SCENES'} sceneIsolated={isolatedSceneId !== null}
          focusMode={focusMode} browserFullscreen={browserFullscreen}
          browserFullscreenBusy={browserFullscreenBusy}
          assetDrawerOpen={assetDrawerOpen}
          onToggleAssetDrawer={onToggleAssetDrawer}
          onFocusScene={() => selectScene(isolatedSceneId ?? activeSceneId ??
            scenes[0]?.scene_id ?? null)}
          onFitOverview={() => selectScene(null)}
          onToggleFocusMode={onToggleFocusMode}
          onToggleBrowserFullscreen={onToggleBrowserFullscreen} />
      </Panel>
    </ReactFlow>
    {loading ? <div className="canvas-status">正在加载持久化布局…</div> : null}
    {error ? <div className="canvas-status" role="alert">{error}</div> : null}
    {snapshot.shot_plans.length === 0 ? <div className="canvas-empty">
      <span>EMPTY STORYBOARD</span><h2>从第一镜开始搭建叙事流程</h2>
      <p>素材、角色、生成任务和 Take 会围绕计划镜头自动形成可追溯关系。</p>
      <button className="button button-primary" disabled={busy}
        onClick={onNewShot} type="button">＋ 新增计划镜头</button></div> : null}
  </div>;
}
