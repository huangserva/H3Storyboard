import { useEffect, useMemo, useRef } from 'react';
import type {
  GenerationPreflight,
  ProjectSnapshot,
  ShotPlan,
  UpdateCanvasNodeInput,
} from '@h3storyboard/protocol';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  useNodesState,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react';
import type {
  StoryboardGraph,
  StoryboardViewEdge,
  StoryboardViewNode,
} from '../lib/storyboard-graph.js';
import { CanvasFlowNode } from './CanvasFlowNode.js';
import type { StoryboardFlowNode } from './storyboard-flow-types.js';

interface StoryboardFlowProps {
  graph: StoryboardGraph;
  snapshot: ProjectSnapshot;
  selectedNodeId: string | null;
  busy: boolean;
  loading: boolean;
  error: string | null;
  preflights: Map<string, GenerationPreflight>;
  onNewShot: () => void;
  onSelect: (node: StoryboardViewNode | null) => void;
  onGenerate: (shot: ShotPlan, preflight: GenerationPreflight,
    reason: string | null) => Promise<boolean>;
  onSetup: () => void;
  onPersist: (input: UpdateCanvasNodeInput) => Promise<void>;
}

const nodeTypes = { storyboard: CanvasFlowNode };

export function StoryboardFlow({ graph, snapshot, selectedNodeId, busy,
  loading, error, preflights, onNewShot, onSelect, onGenerate, onSetup,
  onPersist }: StoryboardFlowProps) {
  const projectedNodes = useMemo(() => graph.nodes.map((view): StoryboardFlowNode => ({
    id: view.id,
    type: 'storyboard',
    position: { x: view.x, y: view.y },
    width: view.width,
    height: view.height,
    zIndex: view.z_index,
    draggable: view.persisted_node_id !== null,
    selectable: view.kind !== 'scene',
    selected: view.id === selectedNodeId,
    className: `flow-node-shell flow-kind-${view.kind}`,
    style: { width: view.width, height: view.height },
    ariaLabel: `${view.kicker}: ${view.title}`,
    data: { view, busy,
      preflight: view.shot_id ? preflights.get(view.shot_id) ?? null : null,
      onGenerate, onSetup },
  })), [busy, graph.nodes, onGenerate, onSetup, preflights, selectedNodeId]);
  const [nodes, setNodes, onNodesChange] = useNodesState(projectedNodes);
  const edges = useMemo(() => graph.edges.map(toFlowEdge), [graph.edges]);
  const dragSessions = useRef(new Map<string, number>());
  const dragStartPositions = useRef(new Map<string, { x: number; y: number }>());
  const nextDragSession = useRef(0);

  useEffect(() => setNodes((current) => {
    const currentById = new Map(current.map((node) => [node.id, node]));
    return projectedNodes.map((node) => {
      const dragged = currentById.get(node.id);
      return dragSessions.current.has(node.id) && dragged
        ? { ...node, position: dragged.position,
          dragging: dragged.dragging ?? false }
        : node;
    });
  }), [projectedNodes, setNodes]);

  const onNodeClick: NodeMouseHandler<StoryboardFlowNode> = (_event, node) => {
    onSelect(node.data.view);
  };

  return <div className="storyboard-flow" data-empty={graph.nodes.length <= 1}>
    <ReactFlow<StoryboardFlowNode, Edge> nodes={nodes} edges={edges}
      nodeTypes={nodeTypes} onNodesChange={onNodesChange}
      onNodeClick={onNodeClick} onPaneClick={() => onSelect(null)}
      onNodeDragStart={(_event, node) => {
        nextDragSession.current += 1;
        dragSessions.current.set(node.id, nextDragSession.current);
        dragStartPositions.current.set(node.id, node.position);
      }}
      onNodeDragStop={(_event, node) => {
        const persistedId = node.data.view.persisted_node_id;
        const session = dragSessions.current.get(node.id);
        const start = dragStartPositions.current.get(node.id);
        if (!persistedId || session === undefined) {
          dragSessions.current.delete(node.id);
          dragStartPositions.current.delete(node.id);
          return;
        }
        void onPersist({ node_id: persistedId, x: node.position.x,
          y: node.position.y, z_index: node.data.view.z_index })
          .catch(() => {
            if (dragSessions.current.get(node.id) !== session || !start) return;
            setNodes((current) => current.map((candidate) => candidate.id === node.id
              ? { ...candidate, position: start } : candidate));
          })
          .finally(() => {
            if (dragSessions.current.get(node.id) !== session) return;
            dragSessions.current.delete(node.id);
            dragStartPositions.current.delete(node.id);
          });
      }}
      fitView fitViewOptions={{ padding: 0.12, minZoom: 0.52, maxZoom: 0.9 }}
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
      <Panel position="top-left" className="flow-toolbar">
        <div><span>UNIVERSAL STORYBOARD</span>
          <small>素材 → 分镜 → H3 JOB → TAKE / QC</small></div>
        <button className="button button-primary compact" disabled={busy}
          onClick={onNewShot} type="button">＋ 新增镜头</button>
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

function toFlowEdge(view: StoryboardViewEdge): Edge {
  const color = edgeColor(view.kind);
  return { id: view.id, source: view.source, target: view.target,
    label: view.label, animated: view.animated,
    type: view.kind === 'continuity' ? 'smoothstep' : 'default',
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
    style: { stroke: color, strokeWidth: view.kind === 'structure' ? 1 : 1.6,
      strokeDasharray: view.kind === 'continuity' ? '6 5' : undefined },
    labelStyle: { fill: '#878e89', fontSize: 8, fontWeight: 650 },
    labelBgStyle: { fill: '#0b0e0d', fillOpacity: 0.88 },
    labelBgPadding: [4, 3], labelBgBorderRadius: 3 };
}

function edgeColor(kind: StoryboardViewEdge['kind']): string {
  return { structure: '#3d4641', reference: '#c8a56a', identity: '#7f8cff',
    generation: '#c9f36b', output: '#53d5bd', continuity: '#a9b6ff' }[kind];
}

function minimapColor(kind: StoryboardViewNode['kind']): string {
  return { script: '#7f8cff', scene: '#313a36', asset: '#c8a56a',
    character: '#a9b6ff', shot: '#c9f36b', job: '#6f7d76', take: '#53d5bd' }[kind];
}
