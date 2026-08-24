import type { ShotActual } from '@h3storyboard/protocol';

interface CanvasTakeControlsProps {
  actual: ShotActual;
  actuals: ShotActual[];
  busy: boolean;
  onSelect: (actualId: string) => void;
  onReviewActual: (actualId: string,
    verdict: 'approved' | 'rejected') => Promise<boolean>;
  onMarkRepresentative: (actualId: string,
    representative: boolean) => Promise<boolean>;
  onReviewRepresentative: (actualId: string,
    status: 'approved' | 'rejected') => Promise<boolean>;
}

export function CanvasTakeControls({ actual, actuals, busy, onSelect,
  onReviewActual, onMarkRepresentative,
  onReviewRepresentative }: CanvasTakeControlsProps) {
  return <section className="canvas-take-controls" aria-label="Take 与 QC">
    {actuals.length > 1 ? <nav className="take-switcher" aria-label="选择 Take">
      {actuals.map((item) => <button data-active={item.id === actual.id}
        key={item.id} onClick={() => onSelect(item.id)} type="button">
        TAKE {String(item.attempt_number).padStart(2, '0')}
        {item.is_representative ? ' · REP' : ''}</button>)}
    </nav> : null}
    <div className="qc-controls"><span>QC · {actual.qc_verdict}</span>
      {actual.qc_verdict === 'pending' ? <div>
        <button disabled={busy} onClick={() => void
          onReviewActual(actual.id, 'approved')} type="button">APPROVE</button>
        <button disabled={busy} onClick={() => void
          onReviewActual(actual.id, 'rejected')} type="button">REJECT</button>
      </div> : null}
    </div>
    <div className="representative-controls">
      <span data-status={actual.representative_status}>
        {actual.is_representative
          ? `REPRESENTATIVE · ${actual.representative_status}`
          : 'NOT REPRESENTATIVE'}</span>
      <div>{actual.is_representative ? <>
        {actual.representative_status === 'pending' ? <>
          <button disabled={busy} onClick={() => void
            onReviewRepresentative(actual.id, 'approved')} type="button">批准开闸</button>
          <button disabled={busy} onClick={() => void
            onReviewRepresentative(actual.id, 'rejected')} type="button">拒绝</button>
        </> : null}
        <button disabled={busy} onClick={() => void
          onMarkRepresentative(actual.id, false)} type="button">撤销代表</button>
      </> : <button disabled={busy} onClick={() => void
        onMarkRepresentative(actual.id, true)} type="button">标为代表 Take</button>}</div>
    </div>
  </section>;
}
