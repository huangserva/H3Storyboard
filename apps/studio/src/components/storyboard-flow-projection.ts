import type {
  CharacterReference,
  GenerationPreflight,
  ProjectSnapshot,
  ShotPlan,
} from '@h3storyboard/protocol';
import { MarkerType, type Edge } from '@xyflow/react';
import { selectShotMediaSlots } from
  '../lib/storyboard-scene-director.js';
import { selectStoryboardBindingSources } from
  '../lib/storyboard-binding.js';
import type {
  StoryboardGraph,
  StoryboardViewEdge,
  StoryboardViewNode,
} from '../lib/storyboard-graph.js';
import type { StoryboardFlowNode } from './storyboard-flow-types.js';

interface ProjectNodesInput {
  graph: StoryboardGraph;
  snapshot: ProjectSnapshot;
  selectedNodeId: string | null;
  selectedNodeIds?: ReadonlySet<string>;
  busy: boolean;
  directorMode: boolean;
  preflights: Map<string, GenerationPreflight>;
  characterReferences: Map<string, CharacterReference>;
  onGenerate: (shot: ShotPlan, preflight: GenerationPreflight,
    reason: string | null) => Promise<boolean>;
  onSetup: () => void;
  onOpenMedia: (assetId: string) => void;
}

export function projectStoryboardNodes({ graph, snapshot, selectedNodeId,
  selectedNodeIds = new Set(), busy,
  directorMode, preflights, characterReferences, onGenerate, onSetup,
  onOpenMedia }: ProjectNodesInput): StoryboardFlowNode[] {
  const assetById = new Map(snapshot.assets.map((asset) => [asset.id, asset]));
  return graph.nodes.map((view): StoryboardFlowNode => ({
    id: view.id,
    type: 'storyboard',
    position: { x: view.x, y: view.y },
    width: view.width,
    height: view.height,
    zIndex: view.z_index,
    draggable: !directorMode && view.persisted_node_id !== null,
    selectable: view.kind !== 'scene',
    selected: selectedNodeIds.has(view.id) || view.id === selectedNodeId,
    className: `flow-node-shell flow-kind-${view.kind}` +
      (directorMode ? ' flow-scene-director-node' : ''),
    style: { width: view.width, height: view.height },
    ariaLabel: `${view.kicker}: ${view.title}`,
    data: { view, busy, directorMode,
      mediaSlots: view.shot ? selectShotMediaSlots(view.shot,
        view.shot_actuals ?? [], assetById, characterReferences) : [],
      preflight: view.shot_id ? preflights.get(view.shot_id) ?? null : null,
      characterReference: view.kind === 'character'
        ? characterReferences.get(view.entity_id) ?? null : null,
      bindingSources: directorMode
        ? selectStoryboardBindingSources(view, snapshot) : [],
      onGenerate, onSetup, onOpenMedia },
  }));
}

export function projectStoryboardEdges(graph: StoryboardGraph): Edge[] {
  return graph.edges.map(toFlowEdge);
}

export function minimapColor(kind: StoryboardViewNode['kind']): string {
  return { script: '#7f8cff', scene: '#313a36', asset: '#c8a56a',
    character: '#a9b6ff', shot: '#c9f36b', job: '#6f7d76', take: '#53d5bd' }[kind];
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
