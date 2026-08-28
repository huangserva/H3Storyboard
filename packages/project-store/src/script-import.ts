import {
  GeneratedShuohaoScriptSchema,
  type ImportScriptInput,
  type ScriptSceneInput,
} from '@h3storyboard/protocol';
import { randomUUID } from 'node:crypto';
import { StoreError } from './errors.js';

export function importScriptScenes(input: ImportScriptInput): ScriptSceneInput[] {
  return input.format === 'shuohao_novel_script'
    ? importShuohao(input.content)
    : importPlainText(input.content);
}

export function importGeneratedScriptScenes(
  rawScript: unknown,
): ScriptSceneInput[] {
  const parsed = GeneratedShuohaoScriptSchema.safeParse(rawScript);
  if (!parsed.success) throw new StoreError(
    'SCRIPT_IMPORT_INVALID',
    'AI generated script does not match the Shuohao contract',
    { issues: parsed.error.issues },
  );
  return importShuohaoRoot(parsed.data).map((scene) => ({
    ...scene,
    beats: scene.beats.map((beat) => ({
      ...beat,
      duration_seconds: beat.kind === 'action'
        ? 2.5 : dialogueDuration(beat.text),
    })),
  }));
}

function importPlainText(content: string): ScriptSceneInput[] {
  const scenes: ScriptSceneInput[] = [];
  let current = newScene(1, 'SC-01', 'SC-01');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = parseHeading(line);
    if (heading) {
      if (current.beats.length > 0) scenes.push(current);
      current = newScene(scenes.length + 1, heading.key, heading.heading);
      continue;
    }
    const dialogue = /^([^：:]{1,40})[：:]\s*(.+)$/.exec(line);
    current.beats.push(dialogue
      ? dialogueBeat(current.beats.length + 1, dialogue[1]!.trim(),
        dialogue[2]!.trim(), '', [dialogue[1]!.trim()])
      : actionBeat(current.beats.length + 1, line, []));
  }
  if (current.beats.length > 0 || scenes.length === 0) scenes.push(current);
  return scenes;
}

function parseHeading(line: string): { key: string; heading: string } | null {
  const match = /^(?:#{1,6}\s*)?(SC(?:ENE)?|场景)[\s#:_-]*(\d+)?\s*(.*)$/i
    .exec(line);
  if (!match) return null;
  const number = Number(match[2] ?? 1);
  return { key: `SC-${String(number).padStart(2, '0')}`, heading: line };
}

function importShuohao(content: string): ScriptSceneInput[] {
  let parsed: unknown;
  try { parsed = JSON.parse(content) as unknown; }
  catch (error) {
    throw new StoreError('SCRIPT_IMPORT_INVALID',
      'Shuohao script content is not valid JSON', error);
  }
  return importShuohaoRoot(parsed);
}

function importShuohaoRoot(parsed: unknown): ScriptSceneInput[] {
  const root = record(parsed);
  const episodes = array(root.episodes, 'episodes');
  const scenes: ScriptSceneInput[] = [];
  for (const [episodeIndex, rawEpisode] of episodes.entries()) {
    const episode = record(rawEpisode);
    const episodeNumber = integer(episode.ep) ?? episodeIndex + 1;
    for (const [sceneIndex, rawScene] of array(episode.scenes, 'scenes').entries()) {
      const scene = record(rawScene);
      const sourceKey = text(scene.sceneId) ?? `S${String(sceneIndex + 1).padStart(2, '0')}`;
      const characters = stringArray(scene.characters);
      const key = `E${String(episodeNumber).padStart(2, '0')}-${sourceKey}`;
      const imported = newScene(scenes.length + 1, key,
        text(scene.heading) ?? key);
      imported.location = text(scene.location) ?? '';
      imported.time_of_day = text(scene.timeOfDay) ??
        text(scene.time_of_day) ?? '';
      imported.lighting = text(scene.lighting) ?? '';
      imported.summary = text(scene.summary) ?? '';
      for (const rawFlow of array(scene.flow, 'flow')) {
        const flow = record(rawFlow);
        const action = text(flow.action);
        const speaker = text(flow.speaker);
        const line = text(flow.line);
        if (action) imported.beats.push(actionBeat(
          imported.beats.length + 1, action, characters));
        else if (speaker && line) imported.beats.push(dialogueBeat(
          imported.beats.length + 1, speaker, line,
          text(flow.delivery) ?? '', unique([...characters, speaker])));
        else throw new StoreError('SCRIPT_IMPORT_INVALID',
          'Every Shuohao flow item must be an action or dialogue');
      }
      scenes.push(imported);
    }
  }
  if (scenes.length === 0) throw new StoreError('SCRIPT_IMPORT_INVALID',
    'Shuohao script must contain at least one scene');
  return scenes;
}

function newScene(ordinal: number, sceneKey: string,
  heading: string): ScriptSceneInput {
  return { id: randomUUID(), ordinal, scene_key: sceneKey, heading,
    location: '', time_of_day: '', lighting: '', summary: '', beats: [] };
}

function actionBeat(ordinal: number, textValue: string,
  characterRefs: string[]): ScriptSceneInput['beats'][number] {
  return { id: randomUUID(), ordinal, kind: 'action', text: textValue,
    duration_seconds: 3, character_refs: unique(characterRefs),
    costume_state: {}, position_state: {}, prop_state: {} };
}

function dialogueBeat(ordinal: number, speaker: string, textValue: string,
  delivery: string,
  characterRefs: string[]): ScriptSceneInput['beats'][number] {
  return { id: randomUUID(), ordinal, kind: 'dialogue', text: textValue,
    speaker, delivery, duration_seconds: 3, character_refs: unique(characterRefs),
    costume_state: {}, position_state: {}, prop_state: {} };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new StoreError('SCRIPT_IMPORT_INVALID',
      'Shuohao script contains an invalid object');
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new StoreError('SCRIPT_IMPORT_INVALID',
    `Shuohao script field ${field} must be an array`);
  return value;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string =>
    typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()) : [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value : null;
}

function unique(values: string[]): string[] { return [...new Set(values)]; }

function dialogueDuration(value: string): number {
  const seconds = value.replace(/\s/g, '').length / 4.5;
  return Math.round(Math.min(15, Math.max(0.5, seconds)) * 1_000) / 1_000;
}
