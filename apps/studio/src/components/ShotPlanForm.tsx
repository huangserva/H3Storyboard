import { useState, type FormEvent } from 'react';
import type { CreateShotPlanInput, H3PromptSpec } from '@h3storyboard/protocol';
import { H3PromptSpecFields } from './H3PromptSpecFields.js';

interface ShotPlanFormProps {
  busy: boolean;
  suggestedScene: string;
  onClose: () => void;
  onCreate: (input: CreateShotPlanInput) => Promise<boolean>;
}

const emptyPromptSpec: H3PromptSpec = {
  subjects: [],
  style: 'Live-action, cinematic', anchor: '', beats: [], soundscape: '',
  lines: [], silent_subjects: [], camera: 'The camera holds a static shot',
  music: 'N/A',
};

const initialTechnical = {
  duration: 6,
  shotSize: '中景',
  movement: '缓慢推进',
};

export function ShotPlanForm({
  busy,
  suggestedScene,
  onClose,
  onCreate,
}: ShotPlanFormProps) {
  const [title, setTitle] = useState('');
  const [sceneId, setSceneId] = useState(suggestedScene);
  const [duration, setDuration] = useState(initialTechnical.duration);
  const [shotSize, setShotSize] = useState(initialTechnical.shotSize);
  const [movement, setMovement] = useState(initialTechnical.movement);
  const [action, setAction] = useState('');
  const [dialogue, setDialogue] = useState('');
  const [sound, setSound] = useState('');
  const [promptSpec, setPromptSpec] = useState<H3PromptSpec>(emptyPromptSpec);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const created = await onCreate({
      title: title.trim(),
      scene_id: sceneId.trim(),
      duration_seconds: duration,
      shot_size: shotSize.trim(),
      camera_movement: movement.trim(),
      action: action.trim(),
      dialogue: dialogue.trim(),
      sound: sound.trim(),
      prompt: '',
      h3_prompt_spec: promptSpec.anchor.trim() && promptSpec.soundscape.trim()
        ? promptSpec : null,
      continuity_mode: 'independent',
      continuity_dependencies: [],
      costume_state: {},
      reference_bindings: [],
      semantic_references: [],
      opening_state: null,
      ending_state: null,
    });
    if (created) onClose();
  }

  return (
    <div className="modal-backdrop align-right" role="presentation" onMouseDown={onClose}>
      <section
        aria-labelledby="new-shot-title"
        aria-modal="true"
        className="composer-card shot-composer"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="composer-header">
          <div>
            <span className="eyebrow">PLANNED SHOT</span>
            <h2 id="new-shot-title">新增计划镜头</h2>
          </div>
          <button aria-label="关闭" className="icon-button" onClick={onClose} type="button">
            ×
          </button>
        </header>

        <form className="composer-form shot-form" onSubmit={submit}>
          <div className="field-grid two-columns">
            <label>
              <span>镜头名称</span>
              <input autoFocus maxLength={160} required value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              <span>场次标识</span>
              <input maxLength={120} required value={sceneId} onChange={(event) => setSceneId(event.target.value)} />
            </label>
          </div>

          <div className="field-grid three-columns">
            <label>
              <span>时长 / 秒</span>
              <input min={4} max={15} type="number" value={duration} onChange={(event) => setDuration(Number(event.target.value))} />
            </label>
            <label>
              <span>景别</span>
              <input maxLength={80} required value={shotSize} onChange={(event) => setShotSize(event.target.value)} />
            </label>
            <label>
              <span>运镜</span>
              <input maxLength={200} required value={movement} onChange={(event) => setMovement(event.target.value)} />
            </label>
          </div>

          <label>
            <span>画面与动作</span>
            <textarea required value={action} onChange={(event) => setAction(event.target.value)} placeholder="人物、位置、动作、光线与构图…" />
          </label>
          <div className="field-grid two-columns">
            <label>
              <span>对白</span>
              <textarea value={dialogue} onChange={(event) => setDialogue(event.target.value)} placeholder="没有可留空" />
            </label>
            <label>
              <span>剧本声音提示（不混音）</span>
              <textarea value={sound} onChange={(event) => setSound(event.target.value)} placeholder="仅作剧本记录；最终只允许 H3 原声或静音" />
            </label>
          </div>
          <H3PromptSpecFields value={promptSpec} onChange={setPromptSpec} />

          <footer className="composer-footer sticky-footer">
            <span>首版默认独立连续性</span>
            <div>
              <button className="button button-ghost" onClick={onClose} type="button">取消</button>
              <button className="button button-primary" disabled={busy} type="submit">
                {busy ? '保存中…' : '保存计划镜头'}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
