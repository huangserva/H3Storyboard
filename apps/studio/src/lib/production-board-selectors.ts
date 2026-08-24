import type {
  Asset,
  CharacterReference,
  H3Job,
  ProjectSnapshot,
  ShotActual,
  ShotPlan,
} from '@h3storyboard/protocol';

export interface ProductionShotProjection {
  shot: ShotPlan;
  jobs: H3Job[];
  actuals: ShotActual[];
  latest_job: H3Job | null;
  latest_actual: ShotActual | null;
  preview_asset: Asset | null;
}

export interface ProductionSceneProjection {
  scene_id: string;
  assets: Array<{ asset: Asset; usage_count: number }>;
  shots: ProductionShotProjection[];
}

export function selectApprovedRootReferences(
  assets: Asset[],
  references: CharacterReference[],
): Map<string, CharacterReference> {
  const approvedAssets = new Set(assets.filter(
    ({ status }) => status === 'approved').map(({ id }) => id));
  const selected = new Map<string, CharacterReference>();
  for (const reference of [...references].sort(
    (left, right) => left.sort_order - right.sort_order)) {
    if (reference.derived_from !== null || reference.kind !== 'image' ||
      !reference.asset_id || !approvedAssets.has(reference.asset_id) ||
      selected.has(reference.character_id)) continue;
    selected.set(reference.character_id, reference);
  }
  return selected;
}

export function selectProductionScenes(
  snapshot: ProjectSnapshot,
): ProductionSceneProjection[] {
  const assetById = new Map(snapshot.assets.map((asset) => [asset.id, asset]));
  const jobsByShot = groupBy(snapshot.h3_jobs, ({ shot_plan_id }) => shot_plan_id);
  const actualsByShot = groupBy(snapshot.shot_actuals,
    ({ shot_plan_id }) => shot_plan_id);
  const shotsByScene = groupBy([...snapshot.shot_plans].sort(
    (left, right) => left.ordinal - right.ordinal), ({ scene_id }) => scene_id);
  return [...shotsByScene].map(([sceneId, shots]) => {
    const assetUsage = new Map<string, number>();
    const projectedShots = shots.map((shot) => {
      const jobs = [...(jobsByShot.get(shot.id) ?? [])].sort(
        (left, right) => left.created_at.localeCompare(right.created_at));
      const actuals = [...(actualsByShot.get(shot.id) ?? [])].sort(
        (left, right) => left.attempt_number - right.attempt_number);
      const latestActual = actuals.at(-1) ?? null;
      const latestJob = jobs.at(-1) ?? null;
      const previewId = latestActual?.output_asset_id ?? latestJob?.output_asset_id ??
        imageReferenceId(shot, 'first_frame');
      for (const assetId of sceneReferenceIds(shot)) {
        assetUsage.set(assetId, (assetUsage.get(assetId) ?? 0) + 1);
      }
      return { shot, jobs, actuals, latest_job: latestJob,
        latest_actual: latestActual,
        preview_asset: previewId ? assetById.get(previewId) ?? null : null };
    });
    return { scene_id: sceneId, shots: projectedShots,
      assets: [...assetUsage].flatMap(([assetId, usageCount]) => {
        const asset = assetById.get(assetId);
        return asset ? [{ asset, usage_count: usageCount }] : [];
      }) };
  });
}

function sceneReferenceIds(shot: ShotPlan): string[] {
  const semantic = shot.semantic_references.flatMap((reference) =>
    reference.purpose === 'reference_stage' && reference.target.type === 'asset'
      ? [reference.target.asset_id] : []);
  const legacy = shot.reference_bindings.flatMap((binding) =>
    binding.role === 'scene' && binding.asset_kind === 'image'
      ? [binding.asset_id] : []);
  return [...new Set([...semantic, ...legacy])];
}

function imageReferenceId(shot: ShotPlan, purpose: 'first_frame'): string | null {
  const target = shot.semantic_references.find((reference) =>
    reference.purpose === purpose && reference.target.type === 'asset')?.target;
  return target?.type === 'asset' ? target.asset_id : null;
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
