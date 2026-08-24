import type { Asset, CharacterReference, ShotActual, ShotPlan } from
  '@h3storyboard/protocol';
import type {
  StoryboardGraph,
  StoryboardViewNode,
} from './storyboard-graph-types.js';

const REFERENCE_X = 90;
const REFERENCE_ASSET_X = 390;
const PLAN_X = 760;
const ACTUAL_X = 1_460;
const TOP = 180;
const ROW_GAP = 120;

export interface StoryboardSceneSummary {
  scene_id: string;
  label: string;
  shot_count: number;
}

export interface ShotMediaSlot {
  key: 'first_frame' | 'last_frame' | 'latest_take';
  label: string;
  asset: Asset | null;
  meta: string;
}

export function listStoryboardScenes(
  graph: StoryboardGraph,
): StoryboardSceneSummary[] {
  const shotsByScene = new Map<string, StoryboardViewNode[]>();
  for (const node of graph.nodes) {
    if (node.kind !== 'shot' || !node.shot) continue;
    const shots = shotsByScene.get(node.shot.scene_id);
    if (shots) shots.push(node);
    else shotsByScene.set(node.shot.scene_id, [node]);
  }
  const sceneById = new Map(graph.nodes.filter(({ kind }) => kind === 'scene')
    .map((scene) => [scene.entity_id, scene]));
  return [...shotsByScene].map(([sceneId, shots]) => ({
    scene_id: sceneId,
    label: sceneById.get(sceneId)?.title ?? sceneId,
    shot_count: shots.length,
    first_ordinal: Math.min(...shots.map(({ shot }) => shot!.ordinal)),
  })).sort((left, right) => left.first_ordinal - right.first_ordinal)
    .map(({ first_ordinal: _firstOrdinal, ...scene }) => scene);
}

export function isolateStoryboardScene(
  graph: StoryboardGraph,
  sceneId: string,
): StoryboardGraph {
  const sceneShots = graph.nodes.filter(({ kind, shot }) =>
    kind === 'shot' && shot?.scene_id === sceneId)
    .sort((left, right) => left.shot!.ordinal - right.shot!.ordinal);
  if (sceneShots.length === 0) return graph;

  const shotIds = new Set(sceneShots.map(({ entity_id }) => entity_id));
  const included = new Set<string>([`scene:${sceneId}`,
    ...sceneShots.map(({ id }) => id),
    ...graph.nodes.filter(({ shot_id }) => shot_id !== null &&
      shotIds.has(shot_id)).map(({ id }) => id),
  ]);

  for (const edge of graph.edges) {
    if (sceneShots.some(({ id }) => id === edge.target) &&
      ['reference', 'identity', 'continuity'].includes(edge.kind)) {
      included.add(edge.source);
    }
  }
  includeIdentityReferences(graph, included);

  const nodes = graph.nodes.filter(({ id }) => included.has(id));
  const edges = graph.edges.filter(({ source, target }) =>
    included.has(source) && included.has(target));
  return layoutSceneDirector({ nodes, edges }, sceneId);
}

export function selectShotMediaSlots(
  shot: ShotPlan,
  actuals: ShotActual[],
  assetById: ReadonlyMap<string, Asset>,
  characterReferences: ReadonlyMap<string, CharacterReference> = new Map(),
): ShotMediaSlot[] {
  const first = referenceAsset(shot, ['first_frame'], assetById,
    characterReferences);
  const last = referenceAsset(shot, ['last_frame', 'reference_target_state'],
    assetById, characterReferences);
  const latest = actuals.reduce<ShotActual | null>((selected, actual) =>
      selected && selected.attempt_number > actual.attempt_number
        ? selected : actual, null);
  const takeAsset = visualAsset(latest
    ? assetById.get(latest.output_asset_id) ?? null : null);
  return [
    { key: 'first_frame', label: '首帧', asset: first,
      meta: first ? 'PLAN INPUT' : '未绑定' },
    { key: 'last_frame', label: '尾帧', asset: last,
      meta: last ? 'PLAN INPUT' : '未绑定' },
    { key: 'latest_take', label: '最新 TAKE', asset: takeAsset,
      meta: latest && takeAsset
        ? `TAKE ${latest.attempt_number} · ${latest.qc_verdict}` : '暂无成片' },
  ];
}

function includeIdentityReferences(graph: StoryboardGraph,
  included: Set<string>): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      if (edge.kind !== 'identity' || !included.has(edge.source) ||
        included.has(edge.target)) continue;
      const target = graph.nodes.find(({ id }) => id === edge.target);
      if (target?.kind !== 'asset' || target.asset_role !== 'reference') continue;
      included.add(edge.target);
      changed = true;
    }
  }
}

function layoutSceneDirector(graph: StoryboardGraph,
  sceneId: string): StoryboardGraph {
  const scene = graph.nodes.find(({ id }) => id === `scene:${sceneId}`) ?? null;
  const shots = graph.nodes.filter(({ kind }) => kind === 'shot')
    .sort((left, right) => left.shot!.ordinal - right.shot!.ordinal);
  const shotRow = new Map(shots.map((shot, index) => [shot.entity_id, index]));
  const references = graph.nodes.filter(({ kind, asset_role, shot_id }) =>
    kind === 'character' || (kind === 'asset' && asset_role === 'reference') ||
    (shot_id !== null && !shotRow.has(shot_id)))
    .sort(compareReferenceNodes);
  const characters = references.filter(({ kind }) => kind === 'character');
  const referenceAssets = references.filter(({ kind }) => kind !== 'character');
  const characterIndex = new Map(characters.map((node, index) => [node.id, index]));
  const assetIndex = new Map(referenceAssets.map((node, index) => [node.id, index]));
  const technical = graph.nodes.filter(({ kind, asset_role, shot_id }) =>
    shot_id !== null && shotRow.has(shot_id) &&
    (kind === 'job' || kind === 'take' ||
      (kind === 'asset' && asset_role === 'output')));
  const technicalByShot = groupBy(technical, ({ shot_id }) => shot_id!);
  const shotY = new Map<string, number>();
  let rowY = TOP;
  for (const shot of shots) {
    shotY.set(shot.entity_id, rowY);
    const technicalRows = Math.ceil(
      (technicalByShot.get(shot.entity_id)?.length ?? 0) / 3);
    const technicalHeight = technicalRows === 0 ? 0 : technicalRows * 220 - 10;
    rowY += Math.max(340, technicalHeight) + ROW_GAP;
  }
  const laidOut = graph.nodes.map((node): StoryboardViewNode => {
    if (node.id === scene?.id) return node;
    if (node.kind === 'shot') {
      return { ...node, x: PLAN_X, y: shotY.get(node.entity_id) ?? TOP,
        width: 520, height: 340, z_index: 3 };
    }
    const characterRow = characterIndex.get(node.id);
    const assetRow = assetIndex.get(node.id);
    if (characterRow !== undefined || assetRow !== undefined) {
      const isCharacter = characterRow !== undefined;
      return { ...node, x: isCharacter ? REFERENCE_X : REFERENCE_ASSET_X,
        y: TOP + (isCharacter ? characterRow! * 280 : assetRow! * 240),
        width: isCharacter ? 270 : 250,
        height: isCharacter ? 250 : 210, z_index: 2 };
    }
    if (node.shot_id && shotRow.has(node.shot_id)) {
      const siblings = [...(technicalByShot.get(node.shot_id) ?? [])]
        .sort((left, right) => left.x - right.x || left.id.localeCompare(right.id));
      const index = siblings.findIndex(({ id }) => id === node.id);
      const laneIndex = Math.max(index, 0);
      return { ...node, x: ACTUAL_X + (laneIndex % 3) * 300,
        y: (shotY.get(node.shot_id) ?? TOP) + Math.floor(laneIndex / 3) * 220,
        width: node.kind === 'job' ? 230 : 270,
        height: node.kind === 'job' ? 120 : 210, z_index: 2 };
    }
    return node;
  });
  const foreground = laidOut.filter(({ kind }) => kind !== 'scene');
  const right = Math.max(...foreground.map(({ x, width }) => x + width));
  const directorRight = Math.max(right, ACTUAL_X + 800);
  const bottom = Math.max(...foreground.map(({ y, height }) => y + height));
  return { nodes: laidOut.map((node) => node.id === scene?.id
    ? { ...node, x: 30, y: 80, width: directorRight + 90, height: bottom,
      z_index: -10, summary: `${shots.length} SHOTS · 参考 / PLAN / H3 ACTUAL` }
    : node), edges: graph.edges };
}

function compareReferenceNodes(left: StoryboardViewNode,
  right: StoryboardViewNode): number {
  if (left.kind !== right.kind) return left.kind === 'character' ? -1 : 1;
  return left.title.localeCompare(right.title, 'zh-CN') || left.id.localeCompare(right.id);
}

function referenceAsset(shot: ShotPlan,
  purposes: Array<ShotPlan['semantic_references'][number]['purpose']>,
  assetById: ReadonlyMap<string, Asset>,
  characterReferences: ReadonlyMap<string, CharacterReference>): Asset | null {
  const target = shot.semantic_references.find((reference) =>
    purposes.includes(reference.purpose))?.target;
  const assetId = target?.type === 'asset' ? target.asset_id : target?.type ===
    'character' ? characterReferences.get(target.character_id)?.asset_id : null;
  return visualAsset(assetId ? assetById.get(assetId) ?? null : null);
}

function visualAsset(asset: Asset | null): Asset | null {
  return asset && asset.kind !== 'audio' ? asset : null;
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
