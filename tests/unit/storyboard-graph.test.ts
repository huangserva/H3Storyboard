import { describe, expect, it } from 'vitest';
import type { CanvasNode, Character, CharacterAssetDerivation,
  CharacterReference, ProjectSnapshot } from '@h3storyboard/protocol';
import { createInitialPositions } from '../../apps/studio/src/lib/canvas-layout.js';
import { buildStoryboardGraph } from '../../apps/studio/src/lib/storyboard-graph.js';

const IDS = {
  project: '00000000-0000-4000-8000-000000000001',
  script: '00000000-0000-4000-8000-000000000002',
  shot1: '00000000-0000-4000-8000-000000000003',
  shot2: '00000000-0000-4000-8000-000000000004',
  job: '00000000-0000-4000-8000-000000000005',
  take: '00000000-0000-4000-8000-000000000006',
  output: '00000000-0000-4000-8000-000000000007',
  reference: '00000000-0000-4000-8000-000000000008',
  character: '00000000-0000-4000-8000-000000000009',
  canvas1: '00000000-0000-4000-8000-000000000010',
  canvas2: '00000000-0000-4000-8000-000000000011',
  canvasCharacter: '00000000-0000-4000-8000-000000000012',
};

function fixture(): {
  snapshot: ProjectSnapshot;
  canvasNodes: CanvasNode[];
  characters: Character[];
} {
  const now = '2026-08-24T00:00:00.000Z';
  const shotBase = {
    project_id: IDS.project, script_version_id: IDS.script,
    duration_seconds: 6, shot_size: '中景', camera_movement: '推进',
    dialogue: '', sound: '', prompt: 'cinematic', costume_state: {},
    opening_state: null, ending_state: null, created_at: now, updated_at: now,
  };
  const snapshot = {
    project: { id: IDS.project, title: '上海雨夜', status: 'active',
      active_script_version_id: IDS.script, created_at: now, updated_at: now },
    script_version: { id: IDS.script, project_id: IDS.project, version: 4,
      title: '雨夜 v4', content: '一段足够长的完整剧本文本。', status: 'locked',
      created_at: now, locked_at: now },
    assets: [
      { id: IDS.reference, project_id: IDS.project, kind: 'image',
        uri: 'refs/rain.png', relative_path: 'refs/rain.png', name: 'rain.png',
        content_hash: null, status: 'approved', replaces_asset_id: null,
        derived_from_asset_id: null, derivation_kind: null,
        producer_job_id: null, created_at: now, updated_at: now },
      { id: IDS.output, project_id: IDS.project, kind: 'video',
        uri: 'outputs/take.mp4', relative_path: 'outputs/take.mp4', name: 'take.mp4',
        content_hash: 'sha256:output', status: 'candidate', replaces_asset_id: null,
        derived_from_asset_id: null, derivation_kind: null,
        producer_job_id: IDS.job, created_at: now, updated_at: now },
    ],
    shot_plans: [
      { ...shotBase, id: IDS.shot1, ordinal: 1, title: '雨巷相遇',
        scene_id: 'SC-01', action: '男人走入雨巷。', continuity_mode: 'independent',
        continuity_dependencies: [], reference_bindings: [],
        semantic_references: [{ purpose: 'reference_character',
          target: { type: 'character', character_id: IDS.character } }] },
      { ...shotBase, id: IDS.shot2, ordinal: 2, title: '回头', scene_id: 'SC-01',
        action: '女人回头。', continuity_mode: 'visual_match',
        continuity_dependencies: [{ source_shot_plan_id: IDS.shot1,
          source_take_id: IDS.take, reference_asset_id: IDS.reference,
          boundary: 'last_frame' }],
        reference_bindings: [{ asset_id: IDS.reference, asset_kind: 'image',
          role: 'first_frame', ordinal: 0 }],
        semantic_references: [{ purpose: 'first_frame',
          target: { type: 'asset', asset_id: IDS.reference } }] },
    ],
    h3_jobs: [{ id: IDS.job, project_id: IDS.project, shot_plan_id: IDS.shot1,
      mode: 't2v', provider: 'local_comfyui', model: 'H3', prompt: 'rain',
      duration_seconds: 6, seed: 8, steps: 20, audio_mode: 'h3_native',
      idempotency_key: 'rain-job-1', input_bindings: [], status: 'completed',
      attempt: 1, provider_job_id: 'provider-1', provider_client_id: null,
      output_asset_id: IDS.output, error_code: null, error_message: null,
      lease_token: null, lease_expires_at: null, heartbeat_at: null,
      created_at: now, updated_at: now, completed_at: now, lock_snapshot: null,
      compiled_bindings: [], gate_override_reason: null, cancel_reason: null }],
    shot_actuals: [{ id: IDS.take, project_id: IDS.project,
      shot_plan_id: IDS.shot1, job_id: IDS.job, output_asset_id: IDS.output,
      observed_description: '雨巷成片', deviation_notes: '', qc_verdict: 'pending',
      attempt_number: 1, created_at: now, reviewed_at: null,
      is_representative: false, representative_status: 'none', approved_at: null }],
  } as ProjectSnapshot;
  const canvasNodes = [
    canvas(IDS.canvas1, 'shot_plan', IDS.shot1, 100, 160),
    canvas(IDS.canvas2, 'shot_plan', IDS.shot2, 100, 520),
    canvas(IDS.canvasCharacter, 'character', IDS.character, -260, 160),
  ];
  const characters = [{ id: IDS.character, project_id: IDS.project,
    name: '阿澄', canonical_appearance: 'young Chinese man in a dark raincoat',
    seed_family: [41], status: 'approved', created_at: now, updated_at: now }] as Character[];
  return { snapshot, canvasNodes, characters };
}

function canvas(id: string, nodeType: 'shot_plan' | 'character', refId: string,
  x: number, y: number): CanvasNode {
  return { id, project_id: IDS.project, node_type: nodeType, ref_id: refId,
    x, y, width: nodeType === 'shot_plan' ? 288 : 230,
    height: nodeType === 'shot_plan' ? 250 : 210, z_index: 1,
    created_at: '2026-08-24T00:00:00.000Z',
    updated_at: '2026-08-24T00:00:00.000Z' };
}

describe('storyboard graph', () => {
  it('derives media, generation, take, identity, and continuity lineage', () => {
    const graph = buildStoryboardGraph(fixture());

    expect(graph.nodes.map(({ id }) => id)).toEqual(expect.arrayContaining([
      `script:${IDS.script}`, 'scene:SC-01', `character:${IDS.character}`,
      `asset:${IDS.reference}`, `asset:${IDS.output}`, `shot:${IDS.shot1}`,
      `job:${IDS.job}`, `take:${IDS.take}`,
    ]));
    expect(graph.edges.map(({ id }) => id)).toEqual(expect.arrayContaining([
      `edge:character:${IDS.character}:shot:${IDS.shot1}:0`,
      `edge:asset:${IDS.reference}:shot:${IDS.shot2}:0`,
      `edge:shot:${IDS.shot1}:job:${IDS.job}`,
      `edge:job:${IDS.job}:asset:${IDS.output}`,
      `edge:asset:${IDS.output}:take:${IDS.take}`,
      `edge:continuity:take:${IDS.take}:shot:${IDS.shot2}:0`,
      `edge:continuity:asset:${IDS.reference}:shot:${IDS.shot2}:0`,
    ]));
  });

  it('keeps provider completion separate from creative approval', () => {
    const graph = buildStoryboardGraph(fixture());
    const job = graph.nodes.find(({ id }) => id === `job:${IDS.job}`);
    const take = graph.nodes.find(({ id }) => id === `take:${IDS.take}`);
    const shot = graph.nodes.find(({ id }) => id === `shot:${IDS.shot1}`);

    expect(job?.status).toBe('completed');
    expect(take?.status).toBe('pending');
    expect(take?.approved).toBe(false);
    expect(shot?.status).toBe('planned');
    expect(shot?.approved).toBe(false);
  });

  it('keeps the default shot, job, and take lanes free of node collisions', () => {
    const input = fixture();
    const positions = createInitialPositions(input.snapshot.shot_plans);
    input.canvasNodes = input.snapshot.shot_plans.map((shot, index) => ({
      ...canvas(`default-canvas-${index}`, 'shot_plan', shot.id,
        positions[shot.id]!.x, positions[shot.id]!.y),
      width: 260,
      height: 196,
    }));

    const graph = buildStoryboardGraph(input);
    const foreground = graph.nodes.filter(({ kind }) => kind !== 'scene');
    const collisions: string[] = [];
    for (let left = 0; left < foreground.length; left += 1) {
      for (let right = left + 1; right < foreground.length; right += 1) {
        const a = foreground[left]!;
        const b = foreground[right]!;
        if (a.x < b.x + b.width && a.x + a.width > b.x &&
          a.y < b.y + b.height && a.y + a.height > b.y) {
          collisions.push(`${a.id} overlaps ${b.id}`);
        }
      }
    }

    expect(collisions).toEqual([]);
  });

  it('keeps fallback layouts read-only and omits orphan reference edges', () => {
    const input = fixture();
    input.canvasNodes = [];
    input.snapshot.shot_plans[0]!.semantic_references = [{
      purpose: 'first_frame',
      target: { type: 'asset', asset_id: crypto.randomUUID() },
    }];
    const graph = buildStoryboardGraph(input);

    expect(graph.nodes.find(({ id }) => id === `shot:${IDS.shot1}`)
      ?.persisted_node_id).toBeNull();
    expect(graph.edges.some(({ id }) => id.startsWith('edge:asset:') &&
      id.endsWith(`:shot:${IDS.shot1}:0`))).toBe(false);
  });

  it('orders multiple job lineages and omits orphan jobs and characters', () => {
    const input = fixture();
    const secondJobId = crypto.randomUUID();
    const secondOutputId = crypto.randomUUID();
    const secondTakeId = crypto.randomUUID();
    const missingCharacterId = crypto.randomUUID();
    const orphanJobId = crypto.randomUUID();
    const orphanOutputId = crypto.randomUUID();
    const firstJob = input.snapshot.h3_jobs[0]!;
    const firstOutput = input.snapshot.assets[1]!;
    input.snapshot.assets.push({ ...firstOutput, id: secondOutputId,
      producer_job_id: secondJobId, uri: 'outputs/take-2.mp4',
      relative_path: 'outputs/take-2.mp4', name: 'take-2.mp4' },
    { ...firstOutput, id: orphanOutputId, producer_job_id: orphanJobId,
      uri: 'outputs/orphan.mp4', relative_path: 'outputs/orphan.mp4',
      name: 'orphan.mp4' });
    input.snapshot.h3_jobs.push({ ...firstJob, id: secondJobId,
      output_asset_id: secondOutputId, idempotency_key: 'rain-job-2',
      created_at: '2026-08-24T01:00:00.000Z' },
    { ...firstJob, id: orphanJobId, shot_plan_id: crypto.randomUUID(),
      output_asset_id: orphanOutputId, idempotency_key: 'orphan-job' });
    input.snapshot.shot_actuals.push({ ...input.snapshot.shot_actuals[0]!,
      id: secondTakeId, job_id: secondJobId, output_asset_id: secondOutputId,
      attempt_number: 2, qc_verdict: 'rejected' });
    input.snapshot.shot_plans[1]!.semantic_references.push({
      purpose: 'reference_character',
      target: { type: 'character', character_id: missingCharacterId },
    }, { purpose: 'first_frame',
      target: { type: 'asset', asset_id: orphanOutputId } });

    const graph = buildStoryboardGraph(input);
    const jobs = graph.nodes.filter(({ kind, shot_id }) =>
      kind === 'job' && shot_id === IDS.shot1);
    const takes = graph.nodes.filter(({ kind, shot_id }) =>
      kind === 'take' && shot_id === IDS.shot1);
    expect(jobs.map(({ id }) => id)).toEqual([
      `job:${IDS.job}`, `job:${secondJobId}`,
    ]);
    expect(takes.map(({ id }) => id)).toEqual([
      `take:${IDS.take}`, `take:${secondTakeId}`,
    ]);
    expect(graph.nodes.find(({ id }) => id === `shot:${IDS.shot1}`)
      ?.preview_asset_id).toBe(secondOutputId);
    expect(jobs[1]!.x).toBeGreaterThan(takes[0]!.x + takes[0]!.width);
    expect(graph.nodes.some(({ id }) => id ===
      `character:${missingCharacterId}`)).toBe(false);
    expect(graph.edges.some(({ source }) => source ===
      `character:${missingCharacterId}`)).toBe(false);
    expect(graph.nodes.filter(({ kind }) => kind === 'job')).toHaveLength(2);
    const renderedIds = new Set(graph.nodes.map(({ id }) => id));
    expect(graph.edges.every(({ source, target }) =>
      renderedIds.has(source) && renderedIds.has(target))).toBe(true);
  });

  it('projects uploaded character assets and their durable identity lineage', () => {
    const input = fixture();
    const sourceId = crypto.randomUUID();
    const angleId = crypto.randomUUID();
    const sourceReferenceId = crypto.randomUUID();
    const angleReferenceId = crypto.randomUUID();
    const assetTemplate = input.snapshot.assets[0]!;
    input.snapshot.assets.push(
      { ...assetTemplate, id: sourceId, name: 'master.png' },
      { ...assetTemplate, id: angleId, name: 'profile.png', status: 'candidate' },
    );
    const references = [{ id: sourceReferenceId, character_id: IDS.character,
      asset_id: sourceId, uri: 'master.png', kind: 'image', content_hash: null,
      derived_from: null, sort_order: 0, created_at: assetTemplate.created_at,
      updated_at: assetTemplate.updated_at },
    { id: angleReferenceId, character_id: IDS.character, asset_id: angleId,
      uri: 'profile.png', kind: 'image', content_hash: null,
      derived_from: sourceReferenceId, sort_order: 1,
      created_at: assetTemplate.created_at,
      updated_at: assetTemplate.updated_at }] as CharacterReference[];
    const derivations = [{ asset_id: angleId, source_asset_id: sourceId,
      kind: 'character_angle_upload',
      created_at: assetTemplate.created_at }] as CharacterAssetDerivation[];

    const graph = buildStoryboardGraph({ ...input,
      characterReferences: references,
      characterAssetDerivations: derivations });

    expect(graph.nodes.map(({ id }) => id)).toEqual(expect.arrayContaining([
      `asset:${sourceId}`, `asset:${angleId}`,
    ]));
    expect(graph.edges).toContainEqual(expect.objectContaining({
      id: `edge:character-asset:${angleId}`,
      source: `asset:${sourceId}`, target: `asset:${angleId}`,
      kind: 'identity', label: 'character_angle_upload',
    }));
    expect(graph.edges).toContainEqual(expect.objectContaining({
      id: `edge:character:${IDS.character}:asset:${sourceId}`,
      source: `character:${IDS.character}`, target: `asset:${sourceId}`,
      kind: 'identity', label: '身份母图',
    }));
  });

  it('is deterministic for a 100-shot project', () => {
    const input = fixture();
    const template = input.snapshot.shot_plans[0]!;
    input.snapshot.shot_plans = Array.from({ length: 100 }, (_, index) => ({
      ...template, id: `shot-${String(index + 1).padStart(3, '0')}`,
      ordinal: index + 1, scene_id: `SC-${Math.floor(index / 10) + 1}`,
      semantic_references: [],
    }));
    input.snapshot.h3_jobs = [];
    input.snapshot.shot_actuals = [];
    input.canvasNodes = input.snapshot.shot_plans.map((shot, index) =>
      canvas(`canvas-${index}`, 'shot_plan', shot.id,
        (index % 5) * 360, Math.floor(index / 5) * 320));

    const first = buildStoryboardGraph(input);
    const second = buildStoryboardGraph(input);
    expect(second).toEqual(first);
    expect(first.nodes.filter(({ kind }) => kind === 'shot')).toHaveLength(100);
    expect(new Set(first.nodes.map(({ id }) => id)).size).toBe(first.nodes.length);
  });
});
