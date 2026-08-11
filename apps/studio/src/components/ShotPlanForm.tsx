import { useState, type FormEvent } from 'react';
import type { CreateShotPlanInput } from '@h3storyboard/protocol';

interface ShotPlanFormProps {
  busy: boolean;
  suggestedScene: string;
  onClose: () => void;
  onCreate: (input: CreateShotPlanInput) => Promise<boolean>;
}

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
  const [prompt, setPrompt] = useState('');

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
      prompt: prompt.trim(),
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
              <span>声音</span>
              <textarea value={sound} onChange={(event) => setSound(event.target.value)} placeholder="环境声、音效、音乐提示" />
            </label>
          </div>
          <label>
            <span>H3 生成提示词</span>
            <textarea className="prompt-textarea" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="此处只写文本意图；参考资产须在右侧绑定后才会进入任务。" />
          </label>

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
