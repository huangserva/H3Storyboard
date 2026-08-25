import type { GenerationPreflight, H3Job, ShotPlan } from
  '@h3storyboard/protocol';

const ACTIVE_JOB_STATUSES = new Set<H3Job['status']>([
  'draft', 'submitting', 'queued', 'running', 'timed_out',
]);

export interface BatchReadiness {
  ready: string[];
  blocked: string[];
  active: string[];
  gate_override: string[];
  can_submit: boolean;
}

export function selectBatchReadiness(
  shots: ShotPlan[],
  preflights: ReadonlyMap<string, GenerationPreflight>,
  jobs: H3Job[],
): BatchReadiness {
  const activeShotIds = new Set(jobs.filter(({ status }) =>
    ACTIVE_JOB_STATUSES.has(status)).map(({ shot_plan_id }) => shot_plan_id));
  const result: BatchReadiness = { ready: [], blocked: [], active: [],
    gate_override: [], can_submit: false };
  for (const shot of shots) {
    if (activeShotIds.has(shot.id)) { result.active.push(shot.id); continue; }
    const preflight = preflights.get(shot.id);
    if (!preflight?.ready || !preflight.mode) {
      result.blocked.push(shot.id); continue;
    }
    result.ready.push(shot.id);
    if (preflight.gate_override_required) result.gate_override.push(shot.id);
  }
  result.can_submit = shots.length > 0 && result.blocked.length === 0 &&
    result.active.length === 0 && result.ready.length === shots.length;
  return result;
}
