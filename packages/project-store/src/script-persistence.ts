import type {
  ScriptBeat,
  ScriptDocument,
  ScriptScene,
  ScriptSceneInput,
  ScriptVersion,
} from '@h3storyboard/protocol';
import type Database from 'better-sqlite3';
import { StoreError } from './errors.js';
import { mapScriptBeat, mapScriptScene, mapScriptVersion } from './row-mappers.js';

export function listScriptVersions(database: Database.Database,
  projectId: string): ScriptVersion[] {
  return database.prepare(`SELECT * FROM script_versions
    WHERE project_id = ? ORDER BY version DESC`).all(projectId).map(mapScriptVersion);
}

export function getScriptDocument(database: Database.Database, projectId: string,
  scriptVersionId: string): ScriptDocument {
  const versionRow = database.prepare(`SELECT * FROM script_versions
    WHERE id = ? AND project_id = ?`).get(scriptVersionId, projectId);
  if (!versionRow) throw new StoreError('SCRIPT_VERSION_NOT_FOUND',
    'Script version does not exist in this project', {
      project_id: projectId, script_version_id: scriptVersionId,
    });
  const beatRows = database.prepare(`SELECT b.* FROM script_beats b
    JOIN script_scenes s ON s.id = b.script_scene_id
    WHERE s.script_version_id = ? ORDER BY s.ordinal, b.ordinal`)
    .all(scriptVersionId).map(mapScriptBeat);
  const beatsByScene = new Map<string, ScriptBeat[]>();
  for (const beat of beatRows) {
    const beats = beatsByScene.get(beat.script_scene_id) ?? [];
    beats.push(beat);
    beatsByScene.set(beat.script_scene_id, beats);
  }
  const scenes = database.prepare(`SELECT * FROM script_scenes
    WHERE script_version_id = ? ORDER BY ordinal`).all(scriptVersionId)
    .map((row) => mapScriptScene(row,
      beatsByScene.get((row as { id: string }).id) ?? []));
  return { version: mapScriptVersion(versionRow), scenes };
}

export function insertScriptScenes(database: Database.Database,
  scriptVersionId: string, scenes: ScriptSceneInput[], now: string): void {
  const insertScene = database.prepare(`INSERT INTO script_scenes
    (id, script_version_id, ordinal, scene_key, heading, location, time_of_day,
     lighting, summary, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertBeat = database.prepare(`INSERT INTO script_beats
    (id, script_scene_id, ordinal, kind, text, speaker, delivery,
     duration_seconds, character_refs_json, costume_state_json,
     position_state_json, prop_state_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const scene of scenes) {
    insertScene.run(scene.id, scriptVersionId, scene.ordinal, scene.scene_key,
      scene.heading, scene.location, scene.time_of_day, scene.lighting,
      scene.summary, now, now);
    for (const beat of scene.beats) insertBeat.run(
      beat.id, scene.id, beat.ordinal, beat.kind, beat.text,
      beat.kind === 'dialogue' ? beat.speaker : null,
      beat.kind === 'dialogue' ? beat.delivery : null,
      beat.duration_seconds, JSON.stringify(beat.character_refs),
      JSON.stringify(beat.costume_state), JSON.stringify(beat.position_state),
      JSON.stringify(beat.prop_state), now, now);
  }
}

export function formatScriptContent(scenes: ScriptSceneInput[]): string {
  return scenes.map((scene) => [scene.heading,
    ...scene.beats.map((beat) => beat.kind === 'dialogue'
      ? `${beat.speaker}：${beat.text}${beat.delivery ? `（${beat.delivery}）` : ''}`
      : beat.text),
  ].join('\n')).join('\n\n');
}

export function assertUniqueDocumentIds(scenes: ScriptSceneInput[]): void {
  const sceneIds = new Set<string>();
  const sceneKeys = new Set<string>();
  const sceneOrdinals = new Set<number>();
  const beatIds = new Set<string>();
  for (const scene of scenes) {
    if (sceneIds.has(scene.id)) throw duplicate('scene', scene.id);
    sceneIds.add(scene.id);
    if (sceneKeys.has(scene.scene_key)) throw duplicate('scene_key', scene.scene_key);
    sceneKeys.add(scene.scene_key);
    if (sceneOrdinals.has(scene.ordinal)) throw duplicate(
      'scene ordinal', String(scene.ordinal));
    sceneOrdinals.add(scene.ordinal);
    const beatOrdinals = new Set<number>();
    for (const beat of scene.beats) {
      if (beatIds.has(beat.id)) throw duplicate('beat', beat.id);
      beatIds.add(beat.id);
      if (beatOrdinals.has(beat.ordinal)) throw duplicate(
        'beat ordinal', `${scene.id}:${beat.ordinal}`);
      beatOrdinals.add(beat.ordinal);
    }
  }
}

function duplicate(kind: string, id: string): StoreError {
  return new StoreError('SCRIPT_DOCUMENT_INVALID',
    `Script ${kind} ids must be unique`, { id });
}

export function documentScenes(document: ScriptDocument): ScriptScene[] {
  return document.scenes;
}

export function documentBeats(document: ScriptDocument): ScriptBeat[] {
  return document.scenes.flatMap(({ beats }) => beats);
}
