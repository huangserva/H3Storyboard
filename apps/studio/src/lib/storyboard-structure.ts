import type {
  CanvasNode,
  Character,
  CharacterAssetDerivation,
  CharacterReference,
  ProjectSnapshot,
  ShotPlan,
} from '@h3storyboard/protocol';
import { normalizedShotLayout } from './storyboard-lineage.js';
import type {
  StoryboardEdgeKind,
  StoryboardViewEdge,
  StoryboardViewNode,
} from './storyboard-graph-types.js';

export function appendSceneNodes(
  nodes: StoryboardViewNode[],
  edges: StoryboardViewEdge[],
  snapshot: ProjectSnapshot,
  shotLayouts: Map<string, CanvasNode>,
): void {
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

export function appendCharacterNodes(
  nodes: StoryboardViewNode[],
  canvasNodes: CanvasNode[],
  referencedIds: Set<string>,
  characterById: Map<string, Character>,
  minX: number,
  minY: number,
): void {
  const layoutByRef = new Map(canvasNodes.map((node) => [node.ref_id, node]));
  let index = 0;
  for (const characterId of referencedIds) {
    const character = characterById.get(characterId);
    if (!character) continue;
    const layout = layoutByRef.get(character.id);
    nodes.push({ id: `character:${character.id}`, kind: 'character',
      entity_id: character.id, x: layout?.x ?? minX - 760,
      y: layout?.y ?? minY + index * 300, width: Math.max(layout?.width ?? 0, 280),
      height: Math.max(layout?.height ?? 0, 260), z_index: layout?.z_index ?? 1,
      persisted_node_id: layout?.id ?? null, title: character.name,
      kicker: 'CHARACTER BIBLE', summary: character.canonical_appearance,
      status: character.status, approved: character.status === 'approved',
      preview_asset_id: null, shot_id: null, character });
    index += 1;
  }
}

export function appendRelationshipEdges(
  edges: StoryboardViewEdge[],
  snapshot: ProjectSnapshot,
  renderedNodeIds: Set<string>,
): void {
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
          takeSource, `shot:${shot.id}`, 'continuity', dependency.boundary));
      }
      const assetSource = `asset:${dependency.reference_asset_id}`;
      if (renderedNodeIds.has(assetSource)) {
        edges.push(edge(`edge:continuity:asset:${dependency.reference_asset_id}:shot:${shot.id}:${index}`,
          assetSource, `shot:${shot.id}`, 'continuity', `${dependency.boundary} 参考帧`));
      }
    });
  }
}

export function appendCharacterAssetDerivationEdges(
  edges: StoryboardViewEdge[],
  derivations: CharacterAssetDerivation[],
  renderedNodeIds: Set<string>,
): void {
  for (const derivation of derivations) {
    const source = `asset:${derivation.source_asset_id}`;
    const target = `asset:${derivation.asset_id}`;
    if (!renderedNodeIds.has(source) || !renderedNodeIds.has(target)) continue;
    edges.push(edge(`edge:character-asset:${derivation.asset_id}`, source, target,
      'identity', derivation.kind));
  }
}

export function appendCharacterReferenceEdges(
  edges: StoryboardViewEdge[],
  references: CharacterReference[],
  renderedNodeIds: Set<string>,
): void {
  for (const reference of references) {
    if (reference.asset_id === null || reference.derived_from !== null) continue;
    const source = `character:${reference.character_id}`;
    const target = `asset:${reference.asset_id}`;
    if (!renderedNodeIds.has(source) || !renderedNodeIds.has(target)) continue;
    edges.push(edge(`edge:character:${reference.character_id}:asset:${reference.asset_id}`,
      source, target, 'identity', '身份母图'));
  }
}

function groupShotsByScene(shots: ShotPlan[]): Map<string, ShotPlan[]> {
  return groupBy([...shots].sort((left, right) => left.ordinal - right.ordinal),
    ({ scene_id }) => scene_id);
}

export function groupBy<T>(
  items: T[],
  keyOf: (item: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

function edge(
  id: string,
  source: string,
  target: string,
  kind: StoryboardEdgeKind,
  label: string,
  animated = false,
): StoryboardViewEdge {
  return { id, source, target, kind, label, animated };
}
