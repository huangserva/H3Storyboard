import { describe, expect, it } from 'vitest';
import type { Asset, CharacterReference, ProjectSnapshot } from
  '@h3storyboard/protocol';
import { selectApprovedRootReferences, selectProductionScenes } from
  '../../apps/studio/src/lib/production-board-selectors.js';

const now = '2026-08-24T00:00:00.000Z';

describe('production board projections', () => {
  it('shows the true latest rejected take and leaves the plan untouched', () => {
    const snapshot = fixture();
    const planBefore = structuredClone(snapshot.shot_plans);

    const scene = selectProductionScenes(snapshot)[0]!;

    expect(scene.shots[0]!.latest_actual).toMatchObject({
      id: 'actual-2', attempt_number: 2, qc_verdict: 'rejected',
    });
    expect(scene.shots[0]!.preview_asset?.id).toBe('output-2');
    expect(scene.assets).toEqual([{ asset: snapshot.assets[0], usage_count: 1 }]);
    expect(snapshot.shot_plans).toEqual(planBefore);
  });

  it('projects one hundred plans without dropping or rewriting any shot', () => {
    const snapshot = fixture();
    const template = snapshot.shot_plans[0]!;
    snapshot.shot_plans = Array.from({ length: 100 }, (_value, index) => ({
      ...template, id: `shot-${index + 1}`, ordinal: index + 1,
      scene_id: `SC-${Math.floor(index / 10) + 1}`,
    }));
    snapshot.h3_jobs = [];
    snapshot.shot_actuals = [];

    const scenes = selectProductionScenes(snapshot);

    expect(scenes).toHaveLength(10);
    expect(scenes.flatMap(({ shots }) => shots)).toHaveLength(100);
    expect(scenes.flatMap(({ shots }) => shots).map(({ shot }) => shot.ordinal))
      .toEqual(Array.from({ length: 100 }, (_value, index) => index + 1));
  });

  it('uses only an approved root mother image for character preview', () => {
    const assets = [
      { id: 'archived-root', status: 'archived' },
      { id: 'approved-angle', status: 'approved' },
    ] as Asset[];
    const references = [
      { id: 'root-ref', character_id: 'character-1', asset_id: 'archived-root',
        kind: 'image', derived_from: null, sort_order: 0 },
      { id: 'angle-ref', character_id: 'character-1', asset_id: 'approved-angle',
        kind: 'image', derived_from: 'root-ref', sort_order: 1 },
    ] as CharacterReference[];

    expect(selectApprovedRootReferences(assets, references)).toEqual(new Map());
  });
});

function fixture(): ProjectSnapshot {
  const project = 'project-1';
  const script = 'script-1';
  const shot = {
    id: 'shot-1', project_id: project, script_version_id: script, ordinal: 1,
    title: '雨夜相遇', scene_id: 'SC-1', duration_seconds: 6,
    shot_size: '中景', camera_movement: '推进', action: '苏婉宁回头。',
    dialogue: '', sound: '', prompt: 'cinematic rain',
    continuity_mode: 'independent', continuity_dependencies: [],
    costume_state: {}, reference_bindings: [], opening_state: null,
    ending_state: null, semantic_references: [{ purpose: 'reference_stage',
      target: { type: 'asset', asset_id: 'stage-1' } }],
    created_at: now, updated_at: now,
  };
  const asset = (id: string) => ({ id, project_id: project, kind: 'image',
    name: `${id}.png`, relative_path: `${id}.png`, uri: `${id}.png`,
    content_hash: null, status: 'candidate', replaces_asset_id: null,
    derived_from_asset_id: null, derivation_kind: null, producer_job_id: null,
    created_at: now, updated_at: now });
  const job = (id: string, output: string, attempt: number) => ({
    id, project_id: project, shot_plan_id: shot.id, mode: 't2v',
    provider: 'local_comfyui', model: 'H3', prompt: 'rain', duration_seconds: 6,
    seed: null, steps: 20, audio_mode: 'h3_native', input_bindings: [],
    idempotency_key: id, attempt, status: 'completed', provider_job_id: id,
    provider_client_id: null, output_asset_id: output, error_code: null,
    error_message: null, lease_token: null, lease_expires_at: null,
    heartbeat_at: null, created_at: now, updated_at: now, completed_at: now,
    lock_snapshot: null, compiled_bindings: [], gate_override_reason: null,
    cancel_reason: null,
  });
  const actual = (id: string, jobId: string, output: string, attempt: number,
    verdict: 'approved' | 'rejected') => ({ id, project_id: project,
      shot_plan_id: shot.id, job_id: jobId, output_asset_id: output,
      attempt_number: attempt, observed_description: id, deviation_notes: '',
      qc_verdict: verdict, created_at: now, reviewed_at: now,
      is_representative: false, representative_status: 'none', approved_at: null });
  return {
    project: { id: project, title: '上海雨夜', status: 'active',
      active_script_version_id: script, created_at: now, updated_at: now },
    script_version: { id: script, project_id: project, version: 1,
      title: '剧本', content: '完整剧本', status: 'locked', created_at: now,
      locked_at: now },
    assets: [asset('stage-1'), asset('output-1'), asset('output-2')],
    shot_plans: [shot],
    h3_jobs: [job('job-1', 'output-1', 1), job('job-2', 'output-2', 2)],
    shot_actuals: [actual('actual-1', 'job-1', 'output-1', 1, 'approved'),
      actual('actual-2', 'job-2', 'output-2', 2, 'rejected')],
  } as unknown as ProjectSnapshot;
}
