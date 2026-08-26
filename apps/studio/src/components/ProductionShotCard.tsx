import type { GenerationPreflight } from '@h3storyboard/protocol';
import { assetFileUrl } from '../lib/api.js';
import type { ProductionShotProjection } from '../lib/production-board-selectors.js';
import { GenerationControl } from './GenerationControl.js';

interface ProductionShotCardProps {
  projection: ProductionShotProjection;
  preflight: GenerationPreflight | null;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onGenerate: (reason: string | null) => Promise<boolean>;
  onSetup: () => void;
  onOpenMedia: (assetId: string) => void;
}

export function ProductionShotCard({ projection, preflight, selected, busy,
  onSelect, onGenerate, onSetup, onOpenMedia }: ProductionShotCardProps) {
  const { shot, latest_job: job, latest_actual: actual,
    preview_asset: preview } = projection;
  return <article className="production-shot-card" data-selected={selected}
    data-shot-card={shot.id} aria-label={`SHOT ${shot.ordinal} ${shot.title}`}>
    <button className="production-shot-select" type="button" onClick={onSelect}>
      <span>SHOT {String(shot.ordinal).padStart(2, '0')} · PLAN</span>
      <i data-ready={preflight?.ready ?? false}>{shot.planning_status === 'draft'
        ? 'DRAFT' : shot.planning_status === 'superseded'
          ? 'SUPERSEDED' : preflight?.ready
            ? 'APPROVED · READY' : 'APPROVED · NEEDS INPUT'}</i>
      <h3>{shot.title}</h3>
      <p>{shot.action}</p>
      <small>{shot.shot_size} · {shot.camera_movement} · {shot.duration_seconds}s</small>
    </button>
    <div className="production-take-slot" data-empty={!actual}>
      <header><span>LATEST TAKE</span><i data-verdict={actual?.qc_verdict ?? 'none'}>
        {actual ? `TAKE ${actual.attempt_number} · ${actual.qc_verdict}` :
          job ? job.status : 'NO TAKE'}</i></header>
      {preview && preview.kind !== 'audio' ? <button type="button"
        className="production-take-media" aria-label={`打开 ${preview.name}`}
        onClick={() => onOpenMedia(preview.id)}>
        {preview.kind === 'video' ? <span className="production-video-take">
          <b>VIDEO TAKE</b><small>点击查看，不在分镜墙预载视频</small>
        </span> : <img alt="" loading="lazy" src={assetFileUrl(preview.id)} />}
      </button> : <div className="production-take-empty">
        <span>{job ? '任务尚未产出可播放媒体' : '尚未建立 Take'}</span>
      </div>}
      <GenerationControl compact busy={busy} job={job} preflight={preflight}
        onGenerate={onGenerate} onSetup={onSetup} />
    </div>
  </article>;
}
