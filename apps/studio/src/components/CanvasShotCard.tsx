import type { Asset, GenerationPreflight, H3Job, ShotActual,
  ShotPlan } from '@h3storyboard/protocol';
import { assetFileUrl } from '../lib/api.js';
import type { ShotMediaSlot } from '../lib/storyboard-scene-director.js';
import { GenerationControl } from './GenerationControl.js';

interface CanvasShotCardProps {
  shot: ShotPlan;
  actuals: ShotActual[];
  previewAsset: Asset | null;
  directorMode: boolean;
  mediaSlots: ShotMediaSlot[];
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
  directorMode,
  mediaSlots,
  selected,
  compileReady,
  busy,
  job,
  preflight,
  onGenerate,
  onSetup,
  onOpenMedia,
}: CanvasShotCardProps) {
  const visibleActuals = directorMode ? actuals : actuals.filter(
    ({ qc_verdict }) => qc_verdict !== 'rejected');
  const latestActual = visibleActuals.reduce<ShotActual | null>(
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
      data-director-card={directorMode}
    >
      <header>
        <span>SHOT {String(shot.ordinal).padStart(2, '0')}</span>
        <i data-compile-ready={compileReady}
          data-planning-status={shot.planning_status}>{shot.planning_status === 'draft'
            ? 'DRAFT' : shot.planning_status === 'superseded'
              ? 'SUPERSEDED' : compileReady
                ? 'APPROVED · 可编译' : 'APPROVED · 缺输入'}</i>
      </header>
      {directorMode ? <div className="canvas-shot-media-grid">
        {mediaSlots.map((slot) => <ShotMediaSlotView key={slot.key}
          slot={slot} onOpenMedia={onOpenMedia} />)}
      </div> : <div className="canvas-card-frame">
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
      </div>}
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

function ShotMediaSlotView({ slot, onOpenMedia }: {
  slot: ShotMediaSlot;
  onOpenMedia: (assetId: string) => void;
}) {
  return <section className="canvas-shot-media-slot" data-media-slot={slot.key}
    data-empty={slot.asset === null}>
    <header><span>{slot.label}</span><small>{slot.meta}</small></header>
    {slot.asset ? <button aria-label={`打开 ${slot.asset.name}`}
      className="canvas-media-trigger nodrag nopan"
      onClick={() => onOpenMedia(slot.asset!.id)} type="button">
      {slot.asset.kind === 'video' ? <video muted playsInline preload="metadata"
        src={assetFileUrl(slot.asset.id)} />
        : <img alt="" loading="lazy" src={assetFileUrl(slot.asset.id)} />}
    </button> : <div className="canvas-shot-media-empty" aria-hidden="true">
      <span>＋</span><small>{slot.key === 'latest_take' ? '等待 H3' : '等待绑定'}</small>
    </div>}
  </section>;
}
