import type { ShotActual, ShotPlan } from '@h3storyboard/protocol';
import type { CanvasPoint } from '../lib/canvas-layout.js';

interface CanvasShotCardProps {
  shot: ShotPlan;
  actuals: ShotActual[];
  position: CanvasPoint;
  selected: boolean;
}

export function CanvasShotCard({
  shot,
  actuals,
  position,
  selected,
}: CanvasShotCardProps) {
  const latestActual = actuals.reduce<ShotActual | null>(
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
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
    >
      <header>
        <span>SHOT {String(shot.ordinal).padStart(2, '0')}</span>
        <i>PLANNED</i>
      </header>
      <div className="canvas-card-frame" aria-hidden="true">
        <b>{shot.shot_size}</b>
        <span>{shot.duration_seconds}s</span>
      </div>
      <h3>{shot.title}</h3>
      <p>{shot.action}</p>
      <footer>
        <span>{shot.camera_movement}</span>
        <span data-verdict={latestActual?.qc_verdict ?? 'none'}>
          {latestActual ? `TAKE ${latestActual.attempt_number} · ${latestActual.qc_verdict}` : 'NO TAKE'}
        </span>
      </footer>
    </article>
  );
}

