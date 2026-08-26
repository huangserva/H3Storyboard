import type { ScriptScene } from '@h3storyboard/protocol';

export interface CompiledScriptShot {
  scene: ScriptScene;
  beat_ids: string[];
  title: string;
  duration_seconds: number;
  action: string;
  dialogue: string;
  costume_state: Record<string, string>;
  position_state: Record<string, string>;
  prop_state: Record<string, string>;
}

export function compileScriptScenes(scenes: ScriptScene[]): CompiledScriptShot[] {
  return scenes.flatMap((scene) => groupScene(scene).map((beats, index) => ({
    scene,
    beat_ids: beats.map(({ id }) => id),
    title: scene.beats.length === beats.length
      ? scene.heading : `${scene.heading} · ${index + 1}`,
    duration_seconds: clampDuration(beats.reduce((sum, beat) =>
      sum + beat.duration_seconds, 0)),
    action: beats.filter(({ kind }) => kind === 'action')
      .map(({ text }) => text).join('\n') || '角色在场景中完成对白动作。',
    dialogue: beats.filter((beat) => beat.kind === 'dialogue')
      .map((beat) => `${beat.speaker}：${beat.text}`).join('\n'),
    costume_state: beats.reduce<Record<string, string>>(
      (state, beat) => ({ ...state, ...beat.costume_state }), {}),
    position_state: beats.reduce<Record<string, string>>(
      (state, beat) => ({ ...state, ...beat.position_state }), {}),
    prop_state: beats.reduce<Record<string, string>>(
      (state, beat) => ({ ...state, ...beat.prop_state }), {}),
  })));
}

function groupScene(scene: ScriptScene): ScriptScene['beats'][] {
  const groups: ScriptScene['beats'][] = [];
  let current: ScriptScene['beats'] = [];
  let duration = 0;
  for (const beat of scene.beats) {
    if (current.length > 0 && duration + beat.duration_seconds > 15) {
      groups.push(current);
      current = [];
      duration = 0;
    }
    current.push(beat);
    duration += beat.duration_seconds;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function clampDuration(value: number): number {
  return Math.min(15, Math.max(4, Math.round(value * 100) / 100));
}
