import type { CanvasNode, ShotActual, ShotPlan } from '@h3storyboard/protocol';

interface CanvasShotCardProps {
  shot: ShotPlan;
  actuals: ShotActual[];
  node: CanvasNode;
  selected: boolean;
  compileReady: boolean;
}

export function CanvasShotCard({
  shot,
  actuals,
  node,
  selected,
  compileReady,
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
      data-canvas-node={node.id}
      data-shot-card={shot.id}
      style={{
        height: node.height,
        transform: `translate(${node.x}px, ${node.y}px)`,
        width: node.width,
        zIndex: node.z_index,
      }}
    >
      <header>
        <span>SHOT {String(shot.ordinal).padStart(2, '0')}</span>
        <i data-compile-ready={compileReady}>{compileReady ? '可编译' : '缺输入'}</i>
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
