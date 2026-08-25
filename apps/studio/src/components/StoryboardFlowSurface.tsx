import type { GenerationPreflight, ProjectSnapshot, ShotPlan } from
  '@h3storyboard/protocol';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  type Edge,
  type ReactFlowProps,
} from '@xyflow/react';
import type { StoryboardGraph } from '../lib/storyboard-graph.js';
import { CanvasBatchBar } from './CanvasBatchBar.js';
import { CanvasFlowNode } from './CanvasFlowNode.js';
import { CanvasViewportToolbar } from './CanvasViewportToolbar.js';
import { SceneCanvasNavigator } from './SceneCanvasNavigator.js';
import { minimapColor } from './storyboard-flow-projection.js';
import type { StoryboardFlowNode } from './storyboard-flow-types.js';

interface StoryboardFlowSurfaceProps {
  flowProps: ReactFlowProps<StoryboardFlowNode, Edge>;
  graph: StoryboardGraph;
  snapshot: ProjectSnapshot;
  scenes: Array<{ scene_id: string; label: string; shot_count: number }>;
  isolatedSceneId: string | null;
  activeSceneId: string | null;
  focusMode: boolean;
  browserFullscreen: boolean;
  browserFullscreenBusy: boolean;
  assetDrawerOpen: boolean;
  loading: boolean;
  error: string | null;
  busy: boolean;
  selectedShots: ShotPlan[];
  preflights: Map<string, GenerationPreflight>;
  onNewShot: () => void;
  onSelectScene: (sceneId: string | null) => void;
  onClearSelection: () => void;
  onGenerateBatch: (shots: ShotPlan[],
    preflights: Map<string, GenerationPreflight>,
    reason: string | null) => Promise<boolean>;
  onSetup: () => void;
  onToggleAssetDrawer: () => void;
  onToggleFocusMode: () => void;
  onToggleBrowserFullscreen: () => void;
}

const nodeTypes = { storyboard: CanvasFlowNode };

export function StoryboardFlowSurface({ flowProps, graph, snapshot, scenes,
  isolatedSceneId, activeSceneId, focusMode, browserFullscreen,
  browserFullscreenBusy, assetDrawerOpen, loading, error, busy, selectedShots,
  preflights, onNewShot, onSelectScene, onClearSelection, onGenerateBatch,
  onSetup, onToggleAssetDrawer, onToggleFocusMode,
  onToggleBrowserFullscreen }: StoryboardFlowSurfaceProps) {
  return <div className="storyboard-flow" data-empty={graph.nodes.length <= 1}
    data-scene-isolated={isolatedSceneId ?? 'all'}>
    <ReactFlow<StoryboardFlowNode, Edge> {...flowProps} nodeTypes={nodeTypes}>
      <Background variant={BackgroundVariant.Dots} gap={24} size={1.1}
        color="rgba(238,234,222,.16)" />
      <Controls position="bottom-left" showInteractive={false} />
      <MiniMap position="bottom-right" pannable zoomable nodeStrokeWidth={2}
        nodeColor={(node) => minimapColor(
          (node as StoryboardFlowNode).data.view.kind)} />
      <Panel position="top-left" className="flow-toolbar canvas-context-bar">
        <SceneCanvasNavigator scenes={scenes} activeSceneId={isolatedSceneId}
          onSelectScene={onSelectScene} />
      </Panel>
      <Panel position="top-right">
        <CanvasViewportToolbar sceneLabel={isolatedSceneId ??
          activeSceneId ?? 'ALL SCENES'} sceneIsolated={isolatedSceneId !== null}
          focusMode={focusMode} browserFullscreen={browserFullscreen}
          browserFullscreenBusy={browserFullscreenBusy}
          assetDrawerOpen={assetDrawerOpen}
          onToggleAssetDrawer={onToggleAssetDrawer}
          onFocusScene={() => onSelectScene(isolatedSceneId ?? activeSceneId ??
            scenes[0]?.scene_id ?? null)}
          onFitOverview={() => onSelectScene(null)}
          onToggleFocusMode={onToggleFocusMode}
          onToggleBrowserFullscreen={onToggleBrowserFullscreen} />
      </Panel>
      {selectedShots.length > 0 ? <Panel position="bottom-center">
        <CanvasBatchBar shots={selectedShots} jobs={snapshot.h3_jobs}
          preflights={preflights} busy={busy} onClear={onClearSelection}
          onGenerate={onGenerateBatch} onSetup={onSetup} />
      </Panel> : null}
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
