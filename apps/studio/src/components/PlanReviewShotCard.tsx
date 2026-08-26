import { useEffect, useState } from 'react';
import type {
  PlanReviewItem,
  UpdateDraftShotPlanInput,
} from '@h3storyboard/protocol';

interface PlanReviewShotCardProps {
  compilationRevision: number;
  disabled: boolean;
  item: PlanReviewItem;
  onDirtyChange: (shotId: string, dirty: boolean) => void;
  onSave: (shotId: string, input: UpdateDraftShotPlanInput) => Promise<unknown>;
}

export function PlanReviewShotCard({ compilationRevision, disabled, item,
  onDirtyChange, onSave }: PlanReviewShotCardProps) {
  const [draft, setDraft] = useState(() => fromItem(item));
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setDraft(fromItem(item));
  }, [dirty, item]);
  useEffect(() => () => onDirtyChange(item.shot_plan.id, false),
    [item.shot_plan.id, onDirtyChange]);
  const shot = item.shot_plan;
  const label = `镜头 ${shot.ordinal}`;
  const set = (field: keyof typeof draft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    if (!dirty) { setDirty(true); onDirtyChange(shot.id, true); }
  };
  const save = async () => {
    const result = await onSave(shot.id, {
    expected_compilation_revision: compilationRevision,
    expected_planning_revision: shot.planning_revision,
    title: draft.title,
    duration_seconds: Number(draft.duration_seconds),
    shot_size: draft.shot_size,
    camera_movement: draft.camera_movement,
    action: draft.action,
    dialogue: draft.dialogue,
    prompt: draft.prompt,
    costume_state: parseState(draft.costume_state),
    position_state: parseState(draft.position_state),
      prop_state: parseState(draft.prop_state),
    });
    if (result) { setDirty(false); onDirtyChange(shot.id, false); }
  };

  return <article className="plan-review-shot" data-change={item.change.kind}
    aria-label={`审核${label}`}>
    <header>
      <div><span className="plan-review-index">SHOT {String(shot.ordinal)
        .padStart(2, '0')}</span><strong>{item.source_scene.heading}</strong></div>
      <span className="plan-review-diff">{diffLabel(item.change.kind)}</span>
    </header>
    <div className="plan-review-source">
      <span>源剧本 · {item.source_scene.scene_key}</span>
      {item.source_beats.map((beat) => <p key={beat.id}>
        {beat.kind === 'dialogue' ? `${beat.speaker}：` : ''}{beat.text}</p>)}
    </div>
    {item.change.changed_fields.length > 0 ? <div className="plan-review-tags">
      {item.change.changed_fields.map((field) => <span key={field}>{field}</span>)}
    </div> : null}
    <div className="plan-review-fields">
      <Field label={`${label} 标题`} value={draft.title} disabled={disabled}
        onChange={(value) => set('title', value)} />
      <Field label={`${label} 时长`} value={draft.duration_seconds} type="number"
        disabled={disabled} onChange={(value) => set('duration_seconds', value)} />
      <Field label={`${label} 景别`} value={draft.shot_size} disabled={disabled}
        onChange={(value) => set('shot_size', value)} />
      <Field label={`${label} 运镜`} value={draft.camera_movement}
        disabled={disabled} onChange={(value) => set('camera_movement', value)} />
      <Field label={`${label} 动作`} value={draft.action} wide multiline
        disabled={disabled} onChange={(value) => set('action', value)} />
      <Field label={`${label} 对白`} value={draft.dialogue} wide multiline
        disabled={disabled} onChange={(value) => set('dialogue', value)} />
      <Field label={`${label} H3 提示词`} value={draft.prompt} wide multiline
        disabled={disabled} onChange={(value) => set('prompt', value)} />
      <Field label={`${label} 服装连续性`} value={draft.costume_state} multiline
        disabled={disabled} onChange={(value) => set('costume_state', value)} />
      <Field label={`${label} 位置连续性`} value={draft.position_state} multiline
        disabled={disabled} onChange={(value) => set('position_state', value)} />
      <Field label={`${label} 道具连续性`} value={draft.prop_state} multiline
        disabled={disabled} onChange={(value) => set('prop_state', value)} />
    </div>
    <footer><span>音频锁定：H3 原声或静音 · 当前为空</span>
      {!disabled ? <button className="button" type="button"
        disabled={!dirty} onClick={() => void save()}>保存{label}修改</button> : null}
      {dirty ? <i className="plan-review-unsaved">未保存</i> : null}</footer>
  </article>;
}

interface FieldProps { label: string; value: string; disabled: boolean;
  multiline?: boolean; wide?: boolean; type?: string;
  onChange(value: string): void }
function Field({ label, value, disabled, multiline, wide, type,
  onChange }: FieldProps) {
  return <label data-wide={wide}>{label}{multiline
    ? <textarea rows={3} disabled={disabled} value={value}
      onChange={(event) => onChange(event.target.value)} />
    : <input type={type ?? 'text'} min={type === 'number' ? 4 : undefined}
      max={type === 'number' ? 15 : undefined} step={type === 'number' ? .5 : undefined}
      disabled={disabled} value={value}
      onChange={(event) => onChange(event.target.value)} />}</label>;
}

function fromItem({ shot_plan: shot }: PlanReviewItem) {
  return { title: shot.title, duration_seconds: String(shot.duration_seconds),
    shot_size: shot.shot_size, camera_movement: shot.camera_movement,
    action: shot.action, dialogue: shot.dialogue, prompt: shot.prompt,
    costume_state: formatState(shot.costume_state),
    position_state: formatState(shot.position_state),
    prop_state: formatState(shot.prop_state) };
}
function formatState(state: Record<string, string>): string {
  return Object.entries(state).map(([key, value]) => `${key}=${value}`).join('\n');
}
function parseState(value: string): Record<string, string> {
  return Object.fromEntries(value.split('\n').map((line) => line.trim())
    .filter(Boolean).map((line) => {
      const separator = line.indexOf('=');
      return separator < 0 ? [line, ''] :
        [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    }));
}
function diffLabel(kind: PlanReviewItem['change']['kind']): string {
  return kind === 'added' ? '新增' : kind === 'changed' ? '已变化' : '未变化';
}
