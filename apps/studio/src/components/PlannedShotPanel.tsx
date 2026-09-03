import type { GenerationPreflight, H3Job, ShotPlan } from '@h3storyboard/protocol';
import { GenerationControl } from './GenerationControl.js';

interface PlannedShotPanelProps {
  shot: ShotPlan | null;
  busy: boolean;
  job: H3Job | null;
  preflight: GenerationPreflight | null;
  onGenerate: (reason: string | null) => Promise<boolean>;
  onSetup: () => void;
}

export function PlannedShotPanel({ shot, busy, job, preflight,
  onGenerate, onSetup }: PlannedShotPanelProps) {
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
        <span className="record-state planned">{shot.planning_status === 'draft'
          ? '剧本编译草稿' : shot.planning_status === 'superseded'
            ? '已被取代' : '已批准'}</span>
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
        <span>H3 PROMPT · h3-film-studio 官方格式{preflight?.film_studio_revision
          ? ` @${preflight.film_studio_revision.slice(0, 7)}` : ''}</span>
        <p>{preflight?.compiled_prompt ?? (shot.h3_prompt_spec
          ? '生成检查通过后显示编译结果' : '尚未填写结构化提示词（h3_prompt_spec）')}</p>
      </div>
      <GenerationControl busy={busy} job={job} preflight={preflight}
        onGenerate={onGenerate} onSetup={onSetup} />
    </section>
  );
}
