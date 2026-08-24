import type { Asset, GenerationPreflight, H3Job, ShotActual,
  ShotPlan } from '@h3storyboard/protocol';
import { assetFileUrl } from '../lib/api.js';
import { GenerationControl } from './GenerationControl.js';

interface CanvasShotCardProps {
  shot: ShotPlan;
  actuals: ShotActual[];
  previewAsset: Asset | null;
  selected: boolean;
  compileReady: boolean;
  busy: boolean;
  job: H3Job | null;
  preflight: GenerationPreflight | null;
  onGenerate: (reason: string | null) => Promise<boolean>;
  onSetup: () => void;
  onOpenMedia: (assetId: string) => void;
}

export function CanvasShotCard({
  shot,
  actuals,
  previewAsset,
  selected,
  compileReady,
  busy,
  job,
  preflight,
  onGenerate,
  onSetup,
  onOpenMedia,
}: CanvasShotCardProps) {
  const latestActual = actuals.filter(({ qc_verdict }) => qc_verdict !== 'rejected')
    .reduce<ShotActual | null>(
    (latest, actual) =>
      !latest || actual.attempt_number > latest.attempt_number ? actual : latest,
    null,
  );
  return (
    <article
      aria-label={`计划分镜 ${shot.ordinal}: ${shot.title}`}
      className="canvas-shot-card"
      data-selected={selected}
      data-shot-card={shot.id}
    >
      <header>
        <span>SHOT {String(shot.ordinal).padStart(2, '0')}</span>
        <i data-compile-ready={compileReady}>{compileReady ? '可编译' : '缺输入'}</i>
      </header>
      <div className="canvas-card-frame">
        {previewAsset && previewAsset.kind !== 'audio'
          ? <button aria-label={`打开 ${previewAsset.name}`}
          className="canvas-media-trigger nodrag nopan"
          onClick={() => onOpenMedia(previewAsset.id)} type="button">
          {previewAsset.kind === 'video' ? <video muted playsInline preload="metadata"
            src={assetFileUrl(previewAsset.id)} />
            : <img alt="" loading="lazy" src={assetFileUrl(previewAsset.id)} />}
          </button> : null}
        <b>{shot.shot_size}</b>
        <span>{shot.duration_seconds}s</span>
      </div>
      <h3>{shot.title}</h3>
      <p>{shot.action}</p>
      <div className="nodrag nopan">
        <GenerationControl compact busy={busy} job={job} preflight={preflight}
          onGenerate={onGenerate} onSetup={onSetup} />
      </div>
      <footer>
        <span>{shot.camera_movement}</span>
        <span data-verdict={latestActual?.qc_verdict ?? 'none'}>
          {latestActual ? `TAKE ${latestActual.attempt_number} · ${latestActual.qc_verdict}` : 'NO TAKE'}
        </span>
      </footer>
    </article>
  );
}
