import type { ScriptBeatInput, ScriptSceneInput } from '@h3storyboard/protocol';
import { ScriptBeatEditor } from './ScriptBeatEditor.js';

interface ScriptSceneEditorProps {
  scene: ScriptSceneInput;
  disabled: boolean;
  onChange: (scene: ScriptSceneInput) => void;
  onRemove: () => void;
}

export function ScriptSceneEditor({ scene, disabled, onChange,
  onRemove }: ScriptSceneEditorProps) {
  const updateBeat = (index: number, beat: ScriptBeatInput) => onChange({
    ...scene, beats: scene.beats.map((item, beatIndex) =>
      beatIndex === index ? beat : item),
  });
  const removeBeat = (index: number) => onChange({ ...scene,
    beats: renumber(scene.beats.filter((_, beatIndex) => beatIndex !== index)) });
  const addBeat = (kind: 'action' | 'dialogue') => {
    const base = { id: crypto.randomUUID(), ordinal: scene.beats.length + 1,
      text: kind === 'action' ? '新的动作。' : '新的对白。', duration_seconds: 3,
      character_refs: [], costume_state: {}, position_state: {}, prop_state: {} };
    onChange({ ...scene, beats: [...scene.beats, kind === 'action'
      ? { ...base, kind } : { ...base, kind, speaker: '角色', delivery: '' }] });
  };
  return <section className="script-scene" aria-label={`场景 ${scene.scene_key}`}>
    <header>
      <div><span>SCENE {String(scene.ordinal).padStart(2, '0')}</span>
        <strong>{scene.scene_key}</strong></div>
      <button className="button compact" disabled={disabled} onClick={onRemove}
        type="button">删除场景</button>
    </header>
    <div className="script-scene-meta">
      <label>编号<input disabled={disabled} value={scene.scene_key}
        onChange={(event) => onChange({ ...scene,
          scene_key: event.target.value })} /></label>
      <label>场景标题<input disabled={disabled} value={scene.heading}
        onChange={(event) => onChange({ ...scene,
          heading: event.target.value })} /></label>
      <label>地点<input disabled={disabled} value={scene.location}
        onChange={(event) => onChange({ ...scene,
          location: event.target.value })} /></label>
      <label>时间<input disabled={disabled} value={scene.time_of_day}
        onChange={(event) => onChange({ ...scene,
          time_of_day: event.target.value })} /></label>
      <label>光线<input disabled={disabled} value={scene.lighting}
        onChange={(event) => onChange({ ...scene,
          lighting: event.target.value })} /></label>
      <label className="script-summary">场景摘要<input disabled={disabled}
        value={scene.summary} onChange={(event) => onChange({ ...scene,
          summary: event.target.value })} /></label>
    </div>
    <div className="script-beat-list">
      {scene.beats.map((beat, index) => <ScriptBeatEditor key={beat.id}
        beat={beat} disabled={disabled}
        onChange={(next) => updateBeat(index, next)}
        onRemove={() => removeBeat(index)} />)}
    </div>
    {!disabled ? <footer>
      <button className="button compact" onClick={() => addBeat('action')}
        type="button">＋ 动作 Beat</button>
      <button className="button compact" onClick={() => addBeat('dialogue')}
        type="button">＋ 对白 Beat</button>
    </footer> : null}
  </section>;
}

function renumber(beats: ScriptBeatInput[]): ScriptBeatInput[] {
  return beats.map((beat, index) => ({ ...beat, ordinal: index + 1 }));
}
