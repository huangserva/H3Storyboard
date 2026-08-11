import type { ShotPlan } from '@h3storyboard/protocol';

interface PlannedShotPanelProps {
  shot: ShotPlan | null;
}

export function PlannedShotPanel({ shot }: PlannedShotPanelProps) {
  if (!shot) {
    return (
      <section className="comparison-card planned-panel empty-panel">
        <span className="panel-index">A</span>
        <div className="empty-symbol">⌜</div>
        <h3>选择一条计划镜头</h3>
        <p>场 / 镜树中的计划记录会在这里展开。</p>
      </section>
    );
  }

  return (
    <section className="comparison-card planned-panel">
      <header className="panel-heading">
        <div>
          <span className="panel-index">A</span>
          <span className="eyebrow">PLANNED / 计划分镜</span>
        </div>
        <span className="record-state planned">已锁定</span>
      </header>
      <div className="shot-title-row">
        <span>{String(shot.ordinal).padStart(2, '0')}</span>
        <h2>{shot.title}</h2>
      </div>
      <div className="technical-strip">
        <span><small>时长</small>{shot.duration_seconds}s</span>
        <span><small>景别</small>{shot.shot_size}</span>
        <span><small>运镜</small>{shot.camera_movement}</span>
      </div>
      <article className="shot-copy">
        <div>
          <span>画面 / 动作</span>
          <p>{shot.action}</p>
        </div>
        <div>
          <span>对白</span>
          <p>{shot.dialogue || '—'}</p>
        </div>
        <div>
          <span>声音</span>
          <p>{shot.sound || '—'}</p>
        </div>
      </article>
      <div className="prompt-block">
        <span>H3 PROMPT</span>
        <p>{shot.prompt || '尚未填写生成提示词'}</p>
      </div>
    </section>
  );
}
