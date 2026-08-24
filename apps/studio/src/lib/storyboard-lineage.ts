import type {
  Asset,
  CanvasNode,
  H3Job,
  ProjectSnapshot,
  ShotActual,
  ShotPlan,
} from '@h3storyboard/protocol';
import type {
  StoryboardEdgeKind,
  StoryboardViewEdge,
  StoryboardViewNode,
} from './storyboard-graph-types.js';

export const SHOT_WIDTH = 260;
export const SHOT_HEIGHT = 196;

interface AppendShotLineageInput {
  nodes: StoryboardViewNode[];
  edges: StoryboardViewEdge[];
  shot: ShotPlan;
  layout: CanvasNode;
  persisted: boolean;
  jobs: H3Job[];
  actuals: ShotActual[];
  assetById: Map<string, Asset>;
  emittedAssetIds: Set<string>;
  lineageX: number;
  lineageY: number;
}

export function appendShotLineage({ nodes, edges, shot, layout, persisted,
  jobs, actuals, assetById, emittedAssetIds, lineageX,
  lineageY }: AppendShotLineageInput): void {
  const orderedJobs = [...jobs].sort(
    (left, right) => left.created_at.localeCompare(right.created_at));
  const orderedActuals = [...actuals].sort(
    (left, right) => left.attempt_number - right.attempt_number);
  const latestActual = selectLatestActual(orderedActuals);
  const firstFrameId = shot.semantic_references.find(({ purpose, target }) =>
    purpose === 'first_frame' && target.type === 'asset')?.target;
  const firstFrameAsset = firstFrameId?.type === 'asset'
    ? assetById.get(firstFrameId.asset_id) : undefined;
  const previewAsset = assetById.get(latestActual?.output_asset_id ?? '') ??
    firstFrameAsset ?? null;
  const normalized = normalizedShotLayout(layout);

  nodes.push({ id: `shot:${shot.id}`, kind: 'shot', entity_id: shot.id,
    x: normalized.x, y: normalized.y, width: normalized.width,
    height: normalized.height, z_index: layout.z_index,
    persisted_node_id: persisted ? layout.id : null, title: shot.title,
    kicker: `SHOT ${String(shot.ordinal).padStart(2, '0')}`,
    summary: shot.action, status: 'planned', approved: false,
    preview_asset_id: previewAsset?.id ?? null, preview_asset: previewAsset,
    shot_id: shot.id, shot, shot_jobs: orderedJobs,
    shot_actuals: orderedActuals });

  let cursorX = lineageX;
  const actualsByJob = groupBy(orderedActuals, ({ job_id }) => job_id);
  for (const job of orderedJobs) {
    nodes.push({ id: `job:${job.id}`, kind: 'job', entity_id: job.id,
      x: cursorX, y: lineageY, width: 196, height: 88, z_index: 2,
      persisted_node_id: null, title: `${job.mode.toUpperCase()} · ${job.model}`,
      kicker: 'H3 JOB', summary: job.error_message ??
        `${job.duration_seconds}s · ${job.steps} steps`, status: job.status,
      approved: false, preview_asset_id: null, shot_id: shot.id, job });
    edges.push(edge(`edge:shot:${shot.id}:job:${job.id}`,
      `shot:${shot.id}`, `job:${job.id}`, 'generation', '生成',
      ['submitting', 'queued', 'running'].includes(job.status)));
    cursorX += 266;

    const takes = actualsByJob.get(job.id) ?? [];
    const takesByOutput = groupBy(takes, ({ output_asset_id }) => output_asset_id);
    const outputIds = uniqueStrings([
      job.output_asset_id,
      ...takes.map(({ output_asset_id }) => output_asset_id),
    ]);
    for (const outputId of outputIds) {
      const asset = assetById.get(outputId);
      if (asset && !emittedAssetIds.has(outputId)) {
        nodes.push({ id: `asset:${asset.id}`, kind: 'asset',
          entity_id: asset.id, x: cursorX, y: lineageY, width: 206, height: 126,
          z_index: 2, persisted_node_id: null, title: asset.name,
          kicker: `${asset.kind.toUpperCase()} OUTPUT`, summary: asset.uri,
          status: asset.status, approved: asset.status === 'approved',
          preview_asset_id: asset.id, preview_asset: asset,
          shot_id: shot.id, asset, asset_role: 'output' });
        emittedAssetIds.add(outputId);
        cursorX += 276;
      }
      if (asset) {
        edges.push(edge(`edge:job:${job.id}:asset:${asset.id}`,
          `job:${job.id}`, `asset:${asset.id}`, 'output', '输出'));
      }
      for (const take of takesByOutput.get(outputId) ?? []) {
        nodes.push({ id: `take:${take.id}`, kind: 'take', entity_id: take.id,
          x: cursorX, y: lineageY, width: 216, height: 116, z_index: 2,
          persisted_node_id: null, title: `TAKE ${take.attempt_number}`,
          kicker: 'ACTUAL / QC', summary: take.observed_description,
          status: take.qc_verdict, approved: take.qc_verdict === 'approved',
          preview_asset_id: take.output_asset_id,
          preview_asset: asset ?? null, shot_id: shot.id, take });
        edges.push(edge(asset
          ? `edge:asset:${outputId}:take:${take.id}`
          : `edge:job:${job.id}:take:${take.id}`,
        asset ? `asset:${outputId}` : `job:${job.id}`, `take:${take.id}`,
        'output', 'QC'));
        cursorX += 286;
      }
    }
    cursorX += 70;
  }
}

export function scriptNode(snapshot: ProjectSnapshot, x: number,
  y: number): StoryboardViewNode {
  return { id: `script:${snapshot.script_version.id}`, kind: 'script',
    entity_id: snapshot.script_version.id, x, y, width: 280, height: 148,
    z_index: 1, persisted_node_id: null, title: snapshot.project.title,
    kicker: `SCRIPT V${snapshot.script_version.version}`,
    summary: snapshot.script_version.title, status: snapshot.script_version.status,
    approved: snapshot.script_version.status === 'locked', preview_asset_id: null,
    shot_id: null, project: snapshot.project, script: snapshot.script_version };
}

export function fallbackShotLayout(shot: ShotPlan, index: number): CanvasNode {
  return { id: `pending:${shot.id}`, project_id: shot.project_id,
    node_type: 'shot_plan', ref_id: shot.id, x: 100 + (index % 3) * 320,
    y: 160 + Math.floor(index / 3) * 240, width: SHOT_WIDTH,
    height: SHOT_HEIGHT, z_index: shot.ordinal,
    created_at: shot.created_at, updated_at: shot.updated_at };
}

export function normalizedShotLayout(layout: CanvasNode): CanvasNode {
  return { ...layout, width: Math.max(layout.width, SHOT_WIDTH),
    height: Math.max(layout.height, SHOT_HEIGHT) };
}

function selectLatestActual(actuals: ShotActual[]): ShotActual | undefined {
  return actuals.at(-1);
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

function uniqueStrings(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))];
}

function edge(id: string, source: string, target: string,
  kind: StoryboardEdgeKind, label: string,
  animated = false): StoryboardViewEdge {
  return { id, source, target, kind, label, animated };
}
