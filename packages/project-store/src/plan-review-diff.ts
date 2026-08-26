import type {
  PlanReviewChange,
  PlanReviewChangedField,
  ShotPlan,
} from '@h3storyboard/protocol';

const comparedFields = [
  'title', 'duration_seconds', 'shot_size', 'camera_movement', 'action',
  'dialogue', 'prompt', 'costume_state', 'position_state', 'prop_state',
] as const satisfies readonly PlanReviewChangedField[];

export interface PlanDiffResult {
  changes: Map<string, PlanReviewChange>;
  removed: ShotPlan[];
}

export function diffPlanSets(current: readonly ShotPlan[],
  baseline: readonly ShotPlan[]): PlanDiffResult {
  const currentByScene = groupByScene(current);
  const baselineByScene = groupByScene(baseline);
  const changes = new Map<string, PlanReviewChange>();
  const removed: ShotPlan[] = [];
  const sceneIds = new Set([...currentByScene.keys(), ...baselineByScene.keys()]);
  for (const sceneId of sceneIds) {
    const sceneCurrent = currentByScene.get(sceneId) ?? [];
    const sceneBaseline = baselineByScene.get(sceneId) ?? [];
    const alignment = alignScene(sceneCurrent, sceneBaseline);
    for (const shot of sceneCurrent) {
      const previous = alignment.matches.get(shot.id) ?? null;
      const changedFields = previous === null ? [...comparedFields] :
        fieldsChanged(shot, previous);
      changes.set(shot.id, {
        kind: previous === null ? 'added' :
          changedFields.length > 0 ? 'changed' : 'unchanged',
        baseline_shot_plan_id: previous?.id ?? null,
        changed_fields: changedFields,
      });
    }
    removed.push(...sceneBaseline.filter(({ id }) =>
      !alignment.matchedBaselineIds.has(id)));
  }
  removed.sort((left, right) => left.ordinal - right.ordinal);
  return { changes, removed };
}

function alignScene(current: readonly ShotPlan[], baseline: readonly ShotPlan[]) {
  const operationCosts = Array.from({ length: current.length + 1 }, () =>
    Array<number>(baseline.length + 1).fill(0));
  const differenceCosts = Array.from({ length: current.length + 1 }, () =>
    Array<number>(baseline.length + 1).fill(0));
  const operations = Array.from({ length: current.length + 1 }, () =>
    Array<'match' | 'add' | 'remove' | null>(baseline.length + 1).fill(null));
  for (let index = 1; index <= current.length; index += 1) {
    operationCosts[index]![0] = index; operations[index]![0] = 'add';
  }
  for (let index = 1; index <= baseline.length; index += 1) {
    operationCosts[0]![index] = index; operations[0]![index] = 'remove';
  }
  for (let currentIndex = 1; currentIndex <= current.length; currentIndex += 1) {
    for (let baselineIndex = 1; baselineIndex <= baseline.length;
      baselineIndex += 1) {
      const changed = fieldsChanged(current[currentIndex - 1]!,
        baseline[baselineIndex - 1]!).length;
      const candidates = [
        { operation: 'match' as const,
          operations: operationCosts[currentIndex - 1]![baselineIndex - 1]! +
            (changed === 0 ? 0 : 1),
          differences: differenceCosts[currentIndex - 1]![baselineIndex - 1]! +
            changed },
        { operation: 'add' as const,
          operations: operationCosts[currentIndex - 1]![baselineIndex]! + 1,
          differences: differenceCosts[currentIndex - 1]![baselineIndex]! },
        { operation: 'remove' as const,
          operations: operationCosts[currentIndex]![baselineIndex - 1]! + 1,
          differences: differenceCosts[currentIndex]![baselineIndex - 1]! },
      ];
      const best = candidates.reduce((winner, candidate) =>
        candidate.operations < winner.operations ||
        (candidate.operations === winner.operations &&
          candidate.differences < winner.differences) ? candidate : winner);
      operationCosts[currentIndex]![baselineIndex] = best.operations;
      differenceCosts[currentIndex]![baselineIndex] = best.differences;
      operations[currentIndex]![baselineIndex] = best.operation;
    }
  }
  const matches = new Map<string, ShotPlan | null>();
  const matchedBaselineIds = new Set<string>();
  let currentIndex = current.length;
  let baselineIndex = baseline.length;
  while (currentIndex > 0 || baselineIndex > 0) {
    const operation = operations[currentIndex]![baselineIndex];
    if (operation === 'match') {
      const currentShot = current[currentIndex - 1]!;
      const baselineShot = baseline[baselineIndex - 1]!;
      matches.set(currentShot.id, baselineShot);
      matchedBaselineIds.add(baselineShot.id);
      currentIndex -= 1; baselineIndex -= 1;
    } else if (operation === 'add') {
      matches.set(current[currentIndex - 1]!.id, null);
      currentIndex -= 1;
    } else {
      baselineIndex -= 1;
    }
  }
  return { matches, matchedBaselineIds };
}

function fieldsChanged(current: ShotPlan,
  previous: ShotPlan): PlanReviewChangedField[] {
  return comparedFields.filter((field) =>
    canonical(current[field]) !== canonical(previous[field]));
}

function groupByScene(shots: readonly ShotPlan[]): Map<string, ShotPlan[]> {
  const grouped = new Map<string, ShotPlan[]>();
  for (const shot of shots) grouped.set(shot.scene_id,
    [...(grouped.get(shot.scene_id) ?? []), shot]);
  return grouped;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
