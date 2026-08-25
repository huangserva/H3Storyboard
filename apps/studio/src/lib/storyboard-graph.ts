import type {
  Asset,
  CanvasNode,
  Character,
  CharacterAssetDerivation,
  CharacterReference,
  ProjectSnapshot,
} from '@h3storyboard/protocol';
import {
  appendShotLineage,
  fallbackShotLayout,
  normalizedShotLayout,
  scriptNode,
} from './storyboard-lineage.js';
import type {
  StoryboardGraph,
  StoryboardViewEdge,
  StoryboardViewNode,
} from './storyboard-graph-types.js';
import {
  appendCharacterNodes,
  appendCharacterAssetDerivationEdges,
  appendCharacterReferenceEdges,
  appendRelationshipEdges,
  appendSceneNodes,
  groupBy,
} from './storyboard-structure.js';
export type {
  StoryboardEdgeKind,
  StoryboardGraph,
  StoryboardNodeKind,
  StoryboardViewEdge,
  StoryboardViewNode,
} from './storyboard-graph-types.js';

interface BuildGraphInput {
  snapshot: ProjectSnapshot;
  canvasNodes: CanvasNode[];
  characters: Character[];
  characterReferences?: CharacterReference[];
  characterAssetDerivations?: CharacterAssetDerivation[];
}

export function buildStoryboardGraph({ snapshot, canvasNodes,
  characters, characterReferences = [],
  characterAssetDerivations = [] }: BuildGraphInput): StoryboardGraph {
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
  for (const reference of characterReferences) {
    if (reference.asset_id) referencedAssets.add(reference.asset_id);
  }
  for (const asset of snapshot.assets) {
    if (asset.kind === 'image' && asset.status !== 'archived' &&
      asset.derived_from_asset_id === null && !outputAssetIds.has(asset.id)) {
      referencedAssets.add(asset.id);
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
      x: minX - 300, y: minY + 280 + assetIndex * 210, width: 250, height: 186,
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
  appendCharacterReferenceEdges(edges, characterReferences,
    new Set(nodes.map(({ id }) => id)));
  appendCharacterAssetDerivationEdges(edges, characterAssetDerivations,
    new Set(nodes.map(({ id }) => id)));
  return { nodes, edges };
}
