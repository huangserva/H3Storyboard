import type { ScriptBeat, ScriptScene } from '@h3storyboard/protocol';
import { describe, expect, it } from 'vitest';
import { compileScriptScenes } from '../../packages/project-store/src/script-compiler.js';

describe('script compiler', () => {
  it('preserves beat order and deterministically splits at the H3 duration limit', () => {
    const scene = scriptScene([
      beat('00000000-0000-4000-8000-000000000001', 1, 8, 'action', '推门。'),
      beat('00000000-0000-4000-8000-000000000002', 2, 7, 'dialogue', '别走。'),
      beat('00000000-0000-4000-8000-000000000003', 3, 0.5, 'action', '停下。'),
    ]);

    const first = compileScriptScenes([scene]);
    const replay = compileScriptScenes([scene]);
    expect(replay).toEqual(first);
    expect(first).toHaveLength(2);
    expect(first[0]).toMatchObject({
      beat_ids: [
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
      ],
      duration_seconds: 15,
      action: '推门。',
      dialogue: '苏晚宁：别走。',
    });
    expect(first[1]).toMatchObject({
      beat_ids: ['00000000-0000-4000-8000-000000000003'],
      duration_seconds: 4,
      action: '停下。',
      dialogue: '',
    });
  });
});

function scriptScene(beats: ScriptBeat[]): ScriptScene {
  return { id: '00000000-0000-4000-8000-000000000010', ordinal: 1,
    scene_key: 'SC-01', heading: '雨巷 夜', location: '雨巷', time_of_day: '夜',
    lighting: '路灯', summary: '',
    script_version_id: '00000000-0000-4000-8000-000000000020', beats,
    created_at: '2026-08-26T00:00:00.000Z',
    updated_at: '2026-08-26T00:00:00.000Z' };
}

function beat(id: string, ordinal: number, duration: number,
  kind: 'action' | 'dialogue', text: string): ScriptBeat {
  const base = { id, ordinal, duration_seconds: duration,
    character_refs: ['苏晚宁'], costume_state: {}, position_state: {},
    prop_state: {}, script_scene_id: '00000000-0000-4000-8000-000000000010',
    created_at: '2026-08-26T00:00:00.000Z',
    updated_at: '2026-08-26T00:00:00.000Z' };
  return kind === 'action' ? { ...base, kind, text }
    : { ...base, kind, text, speaker: '苏晚宁', delivery: '轻声' };
}
