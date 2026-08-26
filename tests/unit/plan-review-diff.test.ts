import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ShotPlan } from '@h3storyboard/protocol';
import { diffPlanSets } from '../../packages/project-store/src/plan-review-diff.js';

describe('plan-set sequence diff', () => {
  it('does not cascade changes when a shot is inserted or removed in a scene',
    () => {
      const baseline = [shot('A'), shot('B'), shot('C')];
      const current = [shot('X'), copy(baseline[0]!), copy(baseline[2]!)];
      const result = diffPlanSets(current, baseline);
      expect(result.changes.get(current[0]!.id)).toMatchObject({ kind: 'added',
        baseline_shot_plan_id: null });
      expect(result.changes.get(current[1]!.id)).toMatchObject({ kind: 'unchanged',
        baseline_shot_plan_id: baseline[0]!.id, changed_fields: [] });
      expect(result.changes.get(current[2]!.id)).toMatchObject({ kind: 'unchanged',
        baseline_shot_plan_id: baseline[2]!.id, changed_fields: [] });
      expect(result.removed.map(({ id }) => id)).toEqual([baseline[1]!.id]);
    });

  it('keeps a heavily revised shot matched instead of reporting add/remove',
    () => {
      const baseline = shot('A');
      const current = { ...copy(baseline), title: 'Rewritten title',
        duration_seconds: 12, shot_size: 'close-up', camera_movement: 'push-in',
        action: 'Entirely rewritten action.', dialogue: 'New dialogue.',
        prompt: 'New prompt.', costume_state: { actor: 'new wardrobe' },
        position_state: { actor: 'right' }, prop_state: { letter: 'torn' } };
      const result = diffPlanSets([current], [baseline]);
      expect(result.changes.get(current.id)).toMatchObject({ kind: 'changed',
        baseline_shot_plan_id: baseline.id });
      expect(result.removed).toEqual([]);
    });
});

function copy(source: ShotPlan): ShotPlan {
  return { ...source, id: randomUUID(), source_script_scene_id: randomUUID(),
    source_script_beat_ids: [randomUUID()] };
}

function shot(label: string): ShotPlan {
  const now = '2026-08-26T00:00:00.000Z';
  return { id: randomUUID(), project_id: randomUUID(),
    script_version_id: randomUUID(), ordinal: 1, title: label,
    scene_id: 'SC-01', duration_seconds: 6, shot_size: 'medium',
    camera_movement: 'locked', action: `Action ${label}`, dialogue: '',
    sound: '', prompt: `Prompt ${label}`, continuity_mode: 'independent',
    continuity_dependencies: [], costume_state: {}, position_state: {},
    prop_state: {}, reference_bindings: [], semantic_references: [],
    opening_state: null, ending_state: null, planning_status: 'draft',
    planning_revision: 0, source_script_scene_id: randomUUID(),
    source_script_beat_ids: [randomUUID()], source_compilation_id: randomUUID(),
    created_at: now, updated_at: now };
}
