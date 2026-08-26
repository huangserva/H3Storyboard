import type {
  ScriptScene,
  ScriptValidation,
  ScriptValidationIssue,
} from '@h3storyboard/protocol';

export function validateScript(scriptVersionId: string,
  scenes: ScriptScene[]): ScriptValidation {
  const issues: ScriptValidationIssue[] = [];
  if (scenes.length === 0) issues.push(issue('SCRIPT_SCENES_REQUIRED',
    'error', '剧本至少需要一个场景'));
  contiguousOrdinals(scenes, 'SCRIPT_SCENE_ORDINAL_INVALID', issues);
  const sceneKeys = new Set<string>();
  const beatIds = new Set<string>();
  for (const scene of scenes) {
    if (sceneKeys.has(scene.scene_key)) issues.push(issue(
      'SCRIPT_SCENE_KEY_DUPLICATE', 'error', '场景编号必须唯一', scene.id));
    sceneKeys.add(scene.scene_key);
    if (scene.beats.length === 0) issues.push(issue('SCRIPT_SCENE_BEATS_REQUIRED',
      'error', '每个场景至少需要一个动作或对白', scene.id));
    contiguousOrdinals(scene.beats, 'SCRIPT_BEAT_ORDINAL_INVALID', issues,
      scene.id);
    for (const beat of scene.beats) {
      if (beatIds.has(beat.id)) issues.push(issue('SCRIPT_BEAT_ID_DUPLICATE',
        'error', 'Beat ID 必须在剧本内唯一', scene.id, beat.id));
      beatIds.add(beat.id);
      if (beat.duration_seconds < 0.5) issues.push(issue(
        'SCRIPT_BEAT_DURATION_TOO_SHORT', 'error',
        'Beat 时长不能短于 0.5 秒', scene.id, beat.id));
      if (beat.duration_seconds > 15) issues.push(issue(
        'SCRIPT_BEAT_DURATION_TOO_LONG', 'error',
        '单个 Beat 不能超过 H3 单段 15 秒上限', scene.id, beat.id));
      const declared = new Set(beat.character_refs);
      const stateRefs = unique([
        ...Object.keys(beat.costume_state),
        ...Object.keys(beat.position_state),
      ]);
      for (const ref of stateRefs) if (!declared.has(ref)) issues.push(issue(
        'SCRIPT_STATE_CHARACTER_UNDECLARED', 'warning',
        `状态中的角色“${ref}”未列入本 Beat 角色`, scene.id, beat.id));
      if (beat.kind === 'dialogue' && !declared.has(beat.speaker)) {
        issues.push(issue('SCRIPT_DIALOGUE_SPEAKER_UNDECLARED', 'warning',
          `对白角色“${beat.speaker}”未列入本 Beat 角色`, scene.id, beat.id));
      }
    }
  }
  return {
    script_version_id: scriptVersionId,
    valid: !issues.some(({ severity }) => severity === 'error'),
    issues,
    statistics: {
      scene_count: scenes.length,
      beat_count: scenes.reduce((sum, scene) => sum + scene.beats.length, 0),
      estimated_duration_seconds: round(scenes.reduce((sum, scene) =>
        sum + scene.beats.reduce((beatSum, beat) =>
          beatSum + beat.duration_seconds, 0), 0)),
    },
  };
}

function contiguousOrdinals(values: Array<{ ordinal: number }>, code: string,
  issues: ScriptValidationIssue[], sceneId: string | null = null): void {
  const sorted = [...values].map(({ ordinal }) => ordinal).sort((a, b) => a - b);
  if (sorted.some((ordinal, index) => ordinal !== index + 1)) {
    issues.push(issue(code, 'error', '顺序编号必须从 1 连续递增', sceneId));
  }
}

function issue(code: string, severity: 'error' | 'warning', message: string,
  scene_id: string | null = null,
  beat_id: string | null = null): ScriptValidationIssue {
  return { code, severity, message, scene_id, beat_id };
}

function unique(values: string[]): string[] { return [...new Set(values)]; }
function round(value: number): number { return Math.round(value * 1_000) / 1_000; }
