import type {
  Asset,
  CanvasNode,
  Character,
  H3Job,
  Project,
  ProjectSnapshot,
  ScriptVersion,
  ShotActual,
  ShotPlan,
} from '@h3storyboard/protocol';
import {
  appendShotLineage,
  fallbackShotLayout,
  normalizedShotLayout,
  scriptNode,
} from './storyboard-lineage.js';
export type StoryboardNodeKind =
  | 'script' | 'scene' | 'asset' | 'character' | 'shot' | 'job' | 'take';
export type StoryboardEdgeKind =
  | 'structure' | 'reference' | 'identity' | 'generation' | 'output' | 'continuity';
interface ViewNodeBase {
  id: string;
  kind: StoryboardNodeKind;
  entity_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z_index: number;
  persisted_node_id: string | null;
  title: string;
  kicker: string;
  summary: string;
  status: string;
  approved: boolean;
  preview_asset_id: string | null;
  shot_id: string | null;
}
export type StoryboardViewNode = ViewNodeBase & {
  project?: Project;
  script?: ScriptVersion;
  scene_id?: string;
  asset?: Asset;
  asset_role?: 'reference' | 'output';
  preview_asset?: Asset | null;
  character?: Character;
  shot?: ShotPlan;
  shot_jobs?: H3Job[];
  shot_actuals?: ShotActual[];
  job?: H3Job;
  take?: ShotActual;
};

export interface StoryboardViewEdge {
  id: string;
  source: string;
  target: string;
  kind: StoryboardEdgeKind;
  label: string;
  animated: boolean;
}

export interface StoryboardGraph {
  nodes: StoryboardViewNode[];
  edges: StoryboardViewEdge[];
}

interface BuildGraphInput {
  snapshot: ProjectSnapshot;
  canvasNodes: CanvasNode[];
  characters: Character[];
}

export function buildStoryboardGraph({ snapshot, canvasNodes,
  characters }: BuildGraphInput): StoryboardGraph {
  const nodes: StoryboardViewNode[] = [];
  const edges: StoryboardViewEdge[] = [];
  const layoutByRef = new Map(canvasNodes.map((node) => [node.ref_id, node]));
  const assetById = new Map(snapshot.assets.map((asset) => [asset.id, asset]));
  const characterById = new Map(characters.map((character) =>
    [character.id, character]));
  const jobsByShot = groupBy(snapshot.h3_jobs, ({ shot_plan_id }) => shot_plan_id);
  const actualsByShot = groupBy(snapshot.shot_actuals,
    ({ shot_plan_id }) => shot_plan_id);
  const outputAssetIds = new Set(snapshot.shot_actuals.map(
    ({ output_asset_id }) => output_asset_id));
  for (const job of snapshot.h3_jobs) {
    if (job.output_asset_id) outputAssetIds.add(job.output_asset_id);
  }
  const shotLayouts = new Map(snapshot.shot_plans.map((shot, index) => {
    const persisted = layoutByRef.get(shot.id);
    return [shot.id, persisted ?? fallbackShotLayout(shot, index)] as const;
  }));
  const minX = Math.min(100, ...[...shotLayouts.values()].map(({ x }) => x));
  const minY = Math.min(100, ...[...shotLayouts.values()].map(({ y }) => y));
  const lineageX = Math.max(100, ...canvasNodes.map((node) =>
    node.x + node.width), ...[...shotLayouts.values()].map((node) => {
    const normalized = normalizedShotLayout(node);
    return normalized.x + normalized.width;
  })) + 160;

  nodes.push(scriptNode(snapshot, minX - 390, minY));
  appendSceneNodes(nodes, edges, snapshot, shotLayouts);

  const referencedAssets = new Set<string>();
  const referencedCharacters = new Set<string>();
  for (const shot of snapshot.shot_plans) {
    for (const reference of shot.semantic_references) {
      if (reference.target.type === 'asset') {
        referencedAssets.add(reference.target.asset_id);
      } else {
        referencedCharacters.add(reference.target.character_id);
      }
    }
    for (const dependency of shot.continuity_dependencies) {
      referencedAssets.add(dependency.reference_asset_id);
    }
  }
  for (const persisted of canvasNodes.filter(
    ({ node_type }) => node_type === 'character')) {
    referencedCharacters.add(persisted.ref_id);
  }

  const emittedAssetIds = new Set<string>();
  let assetIndex = 0;
  for (const assetId of referencedAssets) {
    if (outputAssetIds.has(assetId)) continue;
    const asset = assetById.get(assetId);
    if (!asset) continue;
    nodes.push({ id: `asset:${asset.id}`, kind: 'asset', entity_id: asset.id,
      x: minX - 260, y: minY + 260 + assetIndex * 150, width: 190, height: 126,
      z_index: 1, persisted_node_id: null, title: asset.name,
      kicker: `${asset.kind.toUpperCase()} REFERENCE`, summary: asset.uri,
      status: asset.status, approved: asset.status === 'approved',
      preview_asset_id: asset.id, preview_asset: asset, shot_id: null,
      asset, asset_role: 'reference' });
    emittedAssetIds.add(asset.id);
    assetIndex += 1;
  }
  appendCharacterNodes(nodes, canvasNodes, referencedCharacters,
    characterById, minX, minY);

  const orderedShots = [...snapshot.shot_plans].sort(
    (left, right) => left.ordinal - right.ordinal);
  orderedShots.forEach((shot, index) => appendShotLineage({
    nodes, edges, shot, layout: shotLayouts.get(shot.id)!,
    persisted: layoutByRef.has(shot.id), jobs: jobsByShot.get(shot.id) ?? [],
    actuals: actualsByShot.get(shot.id) ?? [], assetById, emittedAssetIds,
    lineageX, lineageY: minY + index * 240,
  }));

  appendRelationshipEdges(edges, snapshot,
    new Set(nodes.map(({ id }) => id)));
  return { nodes, edges };
}

function appendSceneNodes(nodes: StoryboardViewNode[], edges: StoryboardViewEdge[],
  snapshot: ProjectSnapshot, shotLayouts: Map<string, CanvasNode>): void {
  for (const [sceneId, shots] of groupShotsByScene(snapshot.shot_plans)) {
    const layouts = shots.map((shot) => normalizedShotLayout(shotLayouts.get(shot.id)!));
    const x = Math.min(...layouts.map((node) => node.x)) - 30;
    const y = Math.min(...layouts.map((node) => node.y)) - 64;
    const right = Math.max(...layouts.map((node) => node.x + node.width));
    const bottom = Math.max(...layouts.map((node) => node.y + node.height));
    nodes.push({ id: `scene:${sceneId}`, kind: 'scene', entity_id: sceneId,
      x, y, width: right - x + 30, height: bottom - y + 30, z_index: -10,
      persisted_node_id: null, title: sceneId, kicker: 'SCENE GROUP',
      summary: `${shots.length} SHOTS`, status: 'planned', approved: false,
      preview_asset_id: null, shot_id: null, scene_id: sceneId });
    edges.push(edge(`edge:script:${snapshot.script_version.id}:scene:${sceneId}`,
      `script:${snapshot.script_version.id}`, `scene:${sceneId}`, 'structure', '场景'));
  }
}

function appendCharacterNodes(nodes: StoryboardViewNode[], canvasNodes: CanvasNode[],
  referencedIds: Set<string>, characterById: Map<string, Character>,
  minX: number, minY: number): void {
  const layoutByRef = new Map(canvasNodes.map((node) => [node.ref_id, node]));
  let index = 0;
  for (const characterId of referencedIds) {
    const character = characterById.get(characterId);
    if (!character) continue;
    const layout = layoutByRef.get(character.id);
    nodes.push({ id: `character:${character.id}`, kind: 'character',
      entity_id: character.id, x: layout?.x ?? minX - 700,
      y: layout?.y ?? minY + index * 240, width: Math.max(layout?.width ?? 0, 230),
      height: Math.max(layout?.height ?? 0, 210), z_index: layout?.z_index ?? 1,
      persisted_node_id: layout?.id ?? null, title: character.name,
      kicker: 'CHARACTER BIBLE', summary: character.canonical_appearance,
      status: character.status, approved: character.status === 'approved',
      preview_asset_id: null, shot_id: null, character });
    index += 1;
  }
}

function appendRelationshipEdges(edges: StoryboardViewEdge[], snapshot: ProjectSnapshot,
  renderedNodeIds: Set<string>): void {
  for (const shot of snapshot.shot_plans) {
    edges.push(edge(`edge:scene:${shot.scene_id}:shot:${shot.id}`,
      `scene:${shot.scene_id}`, `shot:${shot.id}`, 'structure', '镜头'));
    shot.semantic_references.forEach((reference, index) => {
      const target = reference.target;
      const entityId = target.type === 'asset' ? target.asset_id :
        target.character_id;
      const prefix = target.type === 'asset' ? 'asset' : 'character';
      const source = `${prefix}:${entityId}`;
      if (!renderedNodeIds.has(source)) return;
      edges.push(edge(`edge:${prefix}:${entityId}:shot:${shot.id}:${index}`,
        source, `shot:${shot.id}`,
        target.type === 'asset' ? 'reference' : 'identity', reference.purpose));
    });
    shot.continuity_dependencies.forEach((dependency, index) => {
      const takeSource = `take:${dependency.source_take_id}`;
      if (renderedNodeIds.has(takeSource)) {
        edges.push(edge(`edge:continuity:take:${dependency.source_take_id}:shot:${shot.id}:${index}`,
          takeSource, `shot:${shot.id}`,
          'continuity', dependency.boundary));
      }
      const assetSource = `asset:${dependency.reference_asset_id}`;
      if (renderedNodeIds.has(assetSource)) {
        edges.push(edge(`edge:continuity:asset:${dependency.reference_asset_id}:shot:${shot.id}:${index}`,
          assetSource, `shot:${shot.id}`,
          'continuity', `${dependency.boundary} 参考帧`));
      }
    });
  }
}

function groupShotsByScene(shots: ShotPlan[]): Map<string, ShotPlan[]> {
  return groupBy([...shots].sort((left, right) => left.ordinal - right.ordinal),
    ({ scene_id }) => scene_id);
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

function edge(id: string, source: string, target: string,
  kind: StoryboardEdgeKind, label: string, animated = false): StoryboardViewEdge {
  return { id, source, target, kind, label, animated };
}
