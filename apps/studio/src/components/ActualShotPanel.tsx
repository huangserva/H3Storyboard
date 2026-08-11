import type { ShotActual } from '@h3storyboard/protocol';

interface ActualShotPanelProps {
  actual: ShotActual | null;
  hasSelectedShot: boolean;
  busy: boolean;
  onMarkRepresentative: (actualId: string, representative: boolean) => Promise<boolean>;
  onReviewRepresentative: (actualId: string,
    status: 'approved' | 'rejected') => Promise<boolean>;
}

export function ActualShotPanel({ actual, hasSelectedShot, busy,
  onMarkRepresentative, onReviewRepresentative }: ActualShotPanelProps) {
  if (!actual) {
    return (
      <section className="comparison-card actual-panel empty-panel">
        <header className="panel-heading empty-heading">
          <div><span className="panel-index">B</span><span className="eyebrow">ACTUAL / 实测分镜</span></div>
          <span className="record-state pending">未生成</span>
        </header>
        <div className="actual-placeholder" aria-hidden="true">
          <span className="scan-line" />
          <i>H3</i>
        </div>
        <h3>{hasSelectedShot ? '尚无实测结果' : '等待选择计划镜头'}</h3>
        <p>{hasSelectedShot ? '提交 H3 任务后，每次生成会作为独立 Take 保留。' : '实测记录不会覆盖计划。'}</p>
      </section>
    );
  }

  return (
    <section className="comparison-card actual-panel">
      <header className="panel-heading">
        <div><span className="panel-index">B</span><span className="eyebrow">ACTUAL / 实测分镜</span></div>
        <span className={`record-state ${actual.qc_verdict}`}>{actual.qc_verdict}</span>
      </header>
      <div className="actual-preview"><span>TAKE {String(actual.attempt_number).padStart(2, '0')}</span></div>
      <div className="representative-controls">
        <span data-status={actual.representative_status}>
          {actual.is_representative
            ? `REPRESENTATIVE · ${actual.representative_status}` : 'NOT REPRESENTATIVE'}
        </span>
        <div>{actual.is_representative ? <>
          {actual.representative_status === 'pending' ? <>
            <button disabled={busy} type="button" onClick={() => void
              onReviewRepresentative(actual.id, 'approved')}>批准开闸</button>
            <button disabled={busy} type="button" onClick={() => void
              onReviewRepresentative(actual.id, 'rejected')}>拒绝</button>
          </> : null}
          <button disabled={busy} type="button" onClick={() => void
            onMarkRepresentative(actual.id, false)}>撤销代表</button>
        </> : <button disabled={busy} type="button" onClick={() => void
          onMarkRepresentative(actual.id, true)}>标为代表 Take</button>}</div>
      </div>
      <article className="shot-copy">
        <div><span>观察记录</span><p>{actual.observed_description}</p></div>
        <div><span>偏差备注</span><p>{actual.deviation_notes || '—'}</p></div>
      </article>
      <div className="actual-lineage">JOB {actual.job_id.slice(0, 8)} · ASSET {actual.output_asset_id.slice(0, 8)}</div>
    </section>
  );
}
