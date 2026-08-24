import { describe, expect, it } from 'vitest';
import type { Asset, ShotActual, ShotPlan } from '@h3storyboard/protocol';
import {
  isolateStoryboardScene,
  listStoryboardScenes,
  selectShotMediaSlots,
} from '../../apps/studio/src/lib/storyboard-scene-director.js';
import type {
  StoryboardGraph,
  StoryboardViewNode,
} from '../../apps/studio/src/lib/storyboard-graph.js';

const NOW = '2026-08-25T00:00:00.000Z';

describe('storyboard scene director', () => {
  it('isolates one complete production lineage into reference, Plan, and Actual lanes', () => {
    const graph = sceneGraph();
    const isolated = isolateStoryboardScene(graph, 'SC-01');
    const ids = isolated.nodes.map(({ id }) => id);

    expect(ids).toEqual(expect.arrayContaining([
      'scene:SC-01', 'character:woman', 'asset:first', 'shot:shot-1',
      'job:job-1', 'asset:output-1', 'take:take-1',
    ]));
    for (const excluded of ['script:script-1', 'scene:SC-02', 'shot:shot-2',
      'character:unused']) expect(ids).not.toContain(excluded);
    expect(isolated.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'asset:first', target: 'shot:shot-1' }),
      expect.objectContaining({ source: 'shot:shot-1', target: 'job:job-1' }),
      expect.objectContaining({ source: 'asset:output-1', target: 'take:take-1' }),
    ]));
    expect(isolated.edges.every(({ source, target }) =>
      ids.includes(source) && ids.includes(target))).toBe(true);

    const reference = isolated.nodes.find(({ id }) => id === 'asset:first')!;
    const shot = isolated.nodes.find(({ id }) => id === 'shot:shot-1')!;
    const job = isolated.nodes.find(({ id }) => id === 'job:job-1')!;
    const output = isolated.nodes.find(({ id }) => id === 'asset:output-1')!;
    const take = isolated.nodes.find(({ id }) => id === 'take:take-1')!;
    expect(reference.x + reference.width).toBeLessThan(shot.x);
    expect(shot.x + shot.width).toBeLessThan(job.x);
    expect([job, output, take].every(({ x }) => x > shot.x + shot.width))
      .toBe(true);
    expect(shot.width).toBeGreaterThanOrEqual(480);
    expect(shot.height).toBeGreaterThanOrEqual(330);
  });

  it('orders scene navigation by shot ordinal and reports exact shot counts', () => {
    const graph = sceneGraph();
    expect(listStoryboardScenes(graph)).toEqual([
      { scene_id: 'SC-01', label: 'SC-01', shot_count: 1 },
      { scene_id: 'SC-02', label: 'SC-02', shot_count: 1 },
    ]);
  });

  it('keeps first frame, last frame, and latest Take in separate slots', () => {
    const first = asset('first', 'image');
    const last = asset('last', 'image');
    const output1 = asset('output-1', 'video');
    const output2 = asset('output-2', 'video');
    const output3 = asset('output-3', 'video');
    const shot = shotPlan('shot-1', 1, 'SC-01', [
      { purpose: 'first_frame', target: { type: 'asset', asset_id: first.id } },
      { purpose: 'last_frame', target: { type: 'asset', asset_id: last.id } },
    ]);
    const actuals = [
      actual('take-1', shot.id, output1.id, 1, 'approved'),
      actual('take-2', shot.id, output2.id, 2, 'pending'),
      actual('take-3', shot.id, output3.id, 3, 'rejected'),
    ];

    const assets = [first, last, output1, output2, output3];
    const slots = selectShotMediaSlots(shot, actuals,
      new Map(assets.map((candidate) => [candidate.id, candidate])));
    expect(slots.map(({ key, asset: selected }) => [key, selected?.id ?? null]))
      .toEqual([
        ['first_frame', first.id],
        ['last_frame', last.id],
        ['latest_take', output3.id],
      ]);
    expect(slots[2]?.meta).toBe('TAKE 3 · rejected');
  });

  it('projects only ten shots when directing one scene of a 100-shot graph', () => {
    const base = sceneGraph();
    const shots = Array.from({ length: 100 }, (_value, index) => node({
      id: `shot:large-${index + 1}`,
      kind: 'shot',
      entity_id: `large-${index + 1}`,
      shot_id: `large-${index + 1}`,
      shot: shotPlan(`large-${index + 1}`, index + 1,
        `SC-${String(Math.floor(index / 10) + 1).padStart(2, '0')}`, []),
    }));
    const scenes = Array.from({ length: 10 }, (_value, index) => node({
      id: `scene:SC-${String(index + 1).padStart(2, '0')}`,
      kind: 'scene',
      entity_id: `SC-${String(index + 1).padStart(2, '0')}`,
      scene_id: `SC-${String(index + 1).padStart(2, '0')}`,
    }));
    const graph = { nodes: [...base.nodes.filter(({ kind }) =>
      kind === 'script'), ...scenes, ...shots], edges: [] };

    const isolated = isolateStoryboardScene(graph, 'SC-07');
    expect(isolated.nodes.filter(({ kind }) => kind === 'shot')).toHaveLength(10);
    expect(isolated.nodes.filter(({ kind }) => kind === 'scene')).toHaveLength(1);
  });

  it('grows a shot row so repeated H3 attempts never overlap the next Plan', () => {
    const graph = sceneGraph();
    const second = graph.nodes.find(({ id }) => id === 'shot:shot-2')!;
    second.shot = { ...second.shot!, scene_id: 'SC-01' };
    graph.nodes.push(...Array.from({ length: 9 }, (_value, index) => node({
      id: `job:retry-${index}`,
      kind: 'job',
      entity_id: `retry-${index}`,
      shot_id: 'shot-1',
    })));

    const isolated = isolateStoryboardScene(graph, 'SC-01');
    const nextShot = isolated.nodes.find(({ id }) => id === 'shot:shot-2')!;
    const firstLineage = isolated.nodes.filter(({ shot_id, kind }) =>
      shot_id === 'shot-1' && kind !== 'shot');
    expect(Math.max(...firstLineage.map(({ y, height }) => y + height)))
      .toBeLessThan(nextShot.y);
  });

  it('resolves character frame references and target-state endings', () => {
    const first = asset('character-first', 'image');
    const last = asset('character-last', 'image');
    const shot = shotPlan('shot-character-frames', 1, 'SC-01', [
      { purpose: 'first_frame', target: { type: 'character',
        character_id: 'character-first' } },
      { purpose: 'reference_target_state', target: { type: 'character',
        character_id: 'character-last' } },
    ]);
    const assets = new Map([[first.id, first], [last.id, last]]);
    const references = new Map([
      ['character-first', characterReference('ref-first', 'character-first', first.id)],
      ['character-last', characterReference('ref-last', 'character-last', last.id)],
    ]);

    expect(selectShotMediaSlots(shot, [], assets, references)
      .map(({ asset: selected }) => selected?.id ?? null))
      .toEqual([first.id, last.id, null]);
  });

  it('returns an invalid scene unchanged and tolerates a missing scene container', () => {
    const graph = sceneGraph();
    expect(isolateStoryboardScene(graph, 'SC-404')).toBe(graph);
    const withoutContainer = { ...graph,
      nodes: graph.nodes.filter(({ id }) => id !== 'scene:SC-01') };
    const isolated = isolateStoryboardScene(withoutContainer, 'SC-01');
    expect(isolated.nodes.some(({ id }) => id === 'shot:shot-1')).toBe(true);
    expect(isolated.nodes.some(({ kind }) => kind === 'scene')).toBe(false);
  });

  it('keeps the empty Actual lane inside the scene fit boundary', () => {
    const graph = sceneGraph();
    graph.nodes = graph.nodes.filter(({ id, kind }) =>
      kind !== 'job' && kind !== 'take' && id !== 'asset:output-1');
    graph.edges = graph.edges.filter(({ source, target }) =>
      graph.nodes.some(({ id }) => id === source) &&
      graph.nodes.some(({ id }) => id === target));
    const isolated = isolateStoryboardScene(graph, 'SC-01');
    const scene = isolated.nodes.find(({ kind }) => kind === 'scene')!;
    expect(scene.x + scene.width).toBeGreaterThanOrEqual(2_260);
  });

  it('brings in only the cross-scene continuity boundary node', () => {
    const graph = sceneGraph();
    graph.nodes.push(
      node({ id: 'job:external', kind: 'job', entity_id: 'external',
        shot_id: 'external-shot' }),
      node({ id: 'asset:external', kind: 'asset', entity_id: 'external',
        shot_id: 'external-shot', asset_role: 'output' }),
      node({ id: 'take:external', kind: 'take', entity_id: 'external',
        shot_id: 'external-shot' }),
    );
    graph.edges.push(
      edge('job:external', 'asset:external', 'output'),
      edge('asset:external', 'take:external', 'output'),
      edge('take:external', 'shot:shot-1', 'continuity'),
    );

    const isolated = isolateStoryboardScene(graph, 'SC-01');
    const ids = isolated.nodes.map(({ id }) => id);
    expect(ids).toContain('take:external');
    expect(ids).not.toContain('job:external');
    expect(ids).not.toContain('asset:external');
    expect(isolated.edges).toContainEqual(expect.objectContaining({
      source: 'take:external', target: 'shot:shot-1', kind: 'continuity',
    }));
  });
});

function sceneGraph(): StoryboardGraph {
  const first = asset('first', 'image');
  const output = asset('output-1', 'video');
  const shot1 = shotPlan('shot-1', 1, 'SC-01', [
    { purpose: 'first_frame', target: { type: 'asset', asset_id: first.id } },
    { purpose: 'reference_character', target: {
      type: 'character', character_id: 'woman' } },
  ]);
  const shot2 = shotPlan('shot-2', 2, 'SC-02', []);
  const nodes = [
    node({ id: 'script:script-1', kind: 'script', entity_id: 'script-1' }),
    node({ id: 'scene:SC-01', kind: 'scene', entity_id: 'SC-01',
      scene_id: 'SC-01', title: 'SC-01' }),
    node({ id: 'scene:SC-02', kind: 'scene', entity_id: 'SC-02',
      scene_id: 'SC-02', title: 'SC-02' }),
    node({ id: 'character:woman', kind: 'character', entity_id: 'woman' }),
    node({ id: 'character:unused', kind: 'character', entity_id: 'unused' }),
    node({ id: 'asset:first', kind: 'asset', entity_id: first.id,
      preview_asset_id: first.id, preview_asset: first, asset: first,
      asset_role: 'reference' }),
    node({ id: 'shot:shot-1', kind: 'shot', entity_id: shot1.id,
      shot_id: shot1.id, shot: shot1 }),
    node({ id: 'shot:shot-2', kind: 'shot', entity_id: shot2.id,
      shot_id: shot2.id, shot: shot2 }),
    node({ id: 'job:job-1', kind: 'job', entity_id: 'job-1',
      shot_id: shot1.id }),
    node({ id: 'asset:output-1', kind: 'asset', entity_id: output.id,
      shot_id: shot1.id, preview_asset_id: output.id, preview_asset: output,
      asset: output, asset_role: 'output' }),
    node({ id: 'take:take-1', kind: 'take', entity_id: 'take-1',
      shot_id: shot1.id }),
  ];
  const edges = [
    edge('scene:SC-01', 'shot:shot-1', 'structure'),
    edge('scene:SC-02', 'shot:shot-2', 'structure'),
    edge('character:woman', 'shot:shot-1', 'identity'),
    edge('asset:first', 'shot:shot-1', 'reference'),
    edge('shot:shot-1', 'job:job-1', 'generation'),
    edge('job:job-1', 'asset:output-1', 'output'),
    edge('asset:output-1', 'take:take-1', 'output'),
  ];
  return { nodes, edges };
}

function node(overrides: Partial<StoryboardViewNode> & Pick<StoryboardViewNode,
  'id' | 'kind' | 'entity_id'>): StoryboardViewNode {
  return { x: 0, y: 0, width: 240, height: 180, z_index: 1,
    persisted_node_id: null, title: overrides.id, kicker: overrides.kind,
    summary: '', status: 'planned', approved: false, preview_asset_id: null,
    shot_id: null, ...overrides };
}

function edge(source: string, target: string,
  kind: StoryboardGraph['edges'][number]['kind']): StoryboardGraph['edges'][number] {
  return { id: `edge:${source}:${target}`, source, target, kind,
    label: kind, animated: false };
}

function asset(id: string, kind: Asset['kind']): Asset {
  return { id, project_id: 'project-1', kind, uri: `${id}.${kind}`,
    relative_path: `${id}.${kind}`, name: id, content_hash: null,
    status: kind === 'video' ? 'candidate' : 'approved', replaces_asset_id: null,
    derived_from_asset_id: null, derivation_kind: null, producer_job_id: null,
    created_at: NOW, updated_at: NOW };
}

function shotPlan(id: string, ordinal: number, sceneId: string,
  semanticReferences: ShotPlan['semantic_references']): ShotPlan {
  return { id, project_id: 'project-1', script_version_id: 'script-1', ordinal,
    title: id, scene_id: sceneId, duration_seconds: 6, shot_size: '中景',
    camera_movement: '推进', action: 'action', dialogue: '', sound: '',
    prompt: 'prompt', costume_state: {}, reference_bindings: [],
    semantic_references: semanticReferences, continuity_mode: 'independent',
    continuity_dependencies: [], opening_state: null, ending_state: null,
    created_at: NOW, updated_at: NOW };
}

function actual(id: string, shotId: string, outputId: string, attempt: number,
  verdict: ShotActual['qc_verdict']): ShotActual {
  return { id, project_id: 'project-1', shot_plan_id: shotId, job_id: `job-${id}`,
    output_asset_id: outputId, observed_description: id, deviation_notes: '',
    qc_verdict: verdict, attempt_number: attempt, created_at: NOW,
    reviewed_at: null, is_representative: false, representative_status: 'none',
    approved_at: null };
}

function characterReference(id: string, characterId: string, assetId: string) {
  return { id, character_id: characterId, asset_id: assetId, uri: assetId,
    kind: 'image' as const, content_hash: null, derived_from: null, sort_order: 0,
    created_at: NOW, updated_at: NOW };
}
