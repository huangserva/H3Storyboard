import { describe, expect, it } from 'vitest';
import type { ProjectSnapshot } from '@h3storyboard/protocol';
import {
  buildShotBinding,
  selectStoryboardBindingSources,
} from '../../apps/studio/src/lib/storyboard-binding.js';
import type { StoryboardViewNode } from
  '../../apps/studio/src/lib/storyboard-graph.js';

const ID = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

describe('storyboard semantic binding projection', () => {
  it('offers visual assets, characters, and only approved Take boundary frames', () => {
    const snapshot = fixture();
    const views = [
      view('asset', ID('11'), { asset: snapshot.assets[0], asset_role: 'reference' }),
      view('character', ID('20'), { character: { id: ID('20') } }),
      view('character', ID('21'), {
        character: { id: ID('21'), status: 'archived' },
      }),
      view('take', ID('31'), { take: snapshot.shot_actuals[0], shot_id: ID('30') }),
      view('take', ID('32'), { take: snapshot.shot_actuals[1], shot_id: ID('30') }),
    ];

    expect(views.map((candidate) => selectStoryboardBindingSources(
      candidate, snapshot).map(({ kind, boundary }) => [kind, boundary ?? null])))
      .toEqual([
        [['asset', null]],
        [['character', null]],
        [],
        [['continuity', 'last_frame']],
        [],
      ]);
  });

  it('maps semantic and continuity handles to the exact API contract', () => {
    expect(buildShotBinding({ kind: 'character', character_id: ID('20') },
      'reference_character', ID('40'))).toEqual({
      binding_type: 'semantic', purpose: 'reference_character',
      target: { type: 'character', character_id: ID('20') },
    });
    expect(buildShotBinding({ kind: 'asset', asset_id: ID('11') },
      'first_frame', ID('40'))).toEqual({
      binding_type: 'semantic', purpose: 'first_frame',
      target: { type: 'asset', asset_id: ID('11') },
    });
    expect(buildShotBinding({ kind: 'continuity', source_shot_plan_id: ID('30'),
      source_take_id: ID('31'), reference_asset_id: ID('13'),
      boundary: 'last_frame' }, 'first_frame', ID('40'))).toEqual({
      binding_type: 'continuity', purpose: 'first_frame',
      source_shot_plan_id: ID('30'), source_take_id: ID('31'),
      reference_asset_id: ID('13'), boundary: 'last_frame',
    });
  });

  it('rejects incompatible targets and self-continuity', () => {
    expect(buildShotBinding({ kind: 'character', character_id: ID('20') },
      'last_frame', ID('40'))).toBeNull();
    expect(buildShotBinding({ kind: 'continuity', source_shot_plan_id: ID('40'),
      source_take_id: ID('31'), reference_asset_id: ID('13'),
      boundary: 'last_frame' }, 'first_frame', ID('40'))).toBeNull();
  });
});

function fixture(): ProjectSnapshot {
  const now = '2026-08-25T00:00:00.000Z';
  const asset = (id: string, kind: 'image' | 'video', extras = {}) => ({
    id, project_id: ID('1'), kind, uri: `${id}.jpg`, relative_path: `${id}.jpg`,
    name: id, content_hash: null, status: 'approved' as const,
    replaces_asset_id: null, derived_from_asset_id: null, derivation_kind: null,
    producer_job_id: null, producer_image_job_id: null,
    created_at: now, updated_at: now, ...extras,
  });
  const output = asset(ID('12'), 'video');
  return {
    project: { id: ID('1'), title: 'P', status: 'active',
      active_script_version_id: ID('2'), created_at: now, updated_at: now },
    script_version: { id: ID('2'), project_id: ID('1'), version: 1,
      title: 'S', content: 'long enough locked script', status: 'locked',
      created_at: now, locked_at: now },
    assets: [asset(ID('11'), 'image'), output,
      asset(ID('13'), 'image', { derived_from_asset_id: output.id,
        derivation_kind: 'last_frame' })],
    shot_plans: [], h3_jobs: [],
    shot_actuals: [
      { id: ID('31'), project_id: ID('1'), shot_plan_id: ID('30'),
        job_id: ID('50'), output_asset_id: output.id, observed_description: 'ok',
        deviation_notes: '', qc_verdict: 'approved', attempt_number: 1,
        created_at: now, reviewed_at: now, is_representative: true,
        representative_status: 'approved', approved_at: now },
      { id: ID('32'), project_id: ID('1'), shot_plan_id: ID('30'),
        job_id: ID('51'), output_asset_id: output.id, observed_description: 'no',
        deviation_notes: '', qc_verdict: 'pending', attempt_number: 2,
        created_at: now, reviewed_at: null, is_representative: false,
        representative_status: 'none', approved_at: null },
    ],
  };
}

function view(kind: StoryboardViewNode['kind'], entityId: string,
  extras: Partial<StoryboardViewNode>): StoryboardViewNode {
  return { id: `${kind}:${entityId}`, kind, entity_id: entityId, x: 0, y: 0,
    width: 100, height: 100, z_index: 1, persisted_node_id: null,
    title: kind, kicker: kind, summary: '', status: 'approved', approved: true,
    preview_asset_id: null, shot_id: null, ...extras } as StoryboardViewNode;
}
