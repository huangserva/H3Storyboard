import type { ScriptBeatInput } from '@h3storyboard/protocol';

interface ScriptBeatEditorProps {
  beat: ScriptBeatInput;
  disabled: boolean;
  onChange: (beat: ScriptBeatInput) => void;
  onRemove: () => void;
}

export function ScriptBeatEditor({ beat, disabled, onChange,
  onRemove }: ScriptBeatEditorProps) {
  const changeKind = (kind: 'action' | 'dialogue') => onChange(kind === 'action'
    ? { ...beat, kind, text: beat.text }
    : { ...beat, kind, text: beat.text, speaker: beat.character_refs[0] ?? '角色',
      delivery: '' });
  return <article className="script-beat" data-kind={beat.kind}>
    <div className="script-beat-index">B{String(beat.ordinal).padStart(2, '0')}</div>
    <div className="script-beat-fields">
      <div className="script-beat-primary">
        <select aria-label={`Beat ${beat.ordinal} 类型`} disabled={disabled}
          value={beat.kind} onChange={(event) => changeKind(
            event.target.value as 'action' | 'dialogue')}>
          <option value="action">动作</option><option value="dialogue">对白</option>
        </select>
        {beat.kind === 'dialogue' ? <input aria-label={`Beat ${beat.ordinal} 说话人`}
          disabled={disabled} value={beat.speaker} placeholder="说话人"
          onChange={(event) => onChange({ ...beat, speaker: event.target.value })} /> : null}
        <input aria-label={`Beat ${beat.ordinal} 时长`} disabled={disabled}
          min="0.5" max="15" step="0.5" type="number"
          value={beat.duration_seconds} onChange={(event) => onChange({ ...beat,
            duration_seconds: Number(event.target.value) })} />
        <button className="button compact" disabled={disabled} onClick={onRemove}
          type="button">删除</button>
      </div>
      <textarea aria-label={`Beat ${beat.ordinal} 内容`} disabled={disabled}
        value={beat.text} rows={2} onChange={(event) => onChange({ ...beat,
          text: event.target.value })} />
      {beat.kind === 'dialogue' ? <input aria-label={`Beat ${beat.ordinal} 语气`}
        disabled={disabled} value={beat.delivery} placeholder="语气 / 表演指示"
        onChange={(event) => onChange({ ...beat, delivery: event.target.value })} /> : null}
      <div className="script-state-grid">
        <input aria-label={`Beat ${beat.ordinal} 角色`} disabled={disabled}
          value={beat.character_refs.join('，')} placeholder="角色（逗号分隔）"
          onChange={(event) => onChange({ ...beat,
            character_refs: split(event.target.value) })} />
        <input aria-label={`Beat ${beat.ordinal} 服装`} disabled={disabled}
          key={`costume-${formatMap(beat.costume_state)}`}
          defaultValue={formatMap(beat.costume_state)} placeholder="服装：角色=状态"
          onBlur={(event) => onChange({ ...beat,
            costume_state: parseMap(event.target.value) })} />
        <input aria-label={`Beat ${beat.ordinal} 位置`} disabled={disabled}
          key={`position-${formatMap(beat.position_state)}`}
          defaultValue={formatMap(beat.position_state)} placeholder="位置：角色=位置"
          onBlur={(event) => onChange({ ...beat,
            position_state: parseMap(event.target.value) })} />
        <input aria-label={`Beat ${beat.ordinal} 道具`} disabled={disabled}
          key={`prop-${formatMap(beat.prop_state)}`}
          defaultValue={formatMap(beat.prop_state)} placeholder="道具：道具=状态"
          onBlur={(event) => onChange({ ...beat,
            prop_state: parseMap(event.target.value) })} />
      </div>
    </div>
  </article>;
}

function split(value: string): string[] {
  return value.split(/[，,]/).map((item) => item.trim()).filter(Boolean);
}
function formatMap(value: Record<string, string>): string {
  return Object.entries(value).map(([key, state]) => `${key}=${state}`).join('；');
}
function parseMap(value: string): Record<string, string> {
  return Object.fromEntries(value.split(/[；;]/).map((entry) => {
    const [key, ...rest] = entry.split('=');
    return [key?.trim() ?? '', rest.join('=').trim()];
  }).filter(([key, state]) => Boolean(key && state)));
}
