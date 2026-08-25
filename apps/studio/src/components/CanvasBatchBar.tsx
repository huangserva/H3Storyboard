import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import type { GenerationPreflight, H3Job, ShotPlan } from
  '@h3storyboard/protocol';
import { selectBatchReadiness } from '../lib/storyboard-batch.js';

interface CanvasBatchBarProps {
  shots: ShotPlan[];
  jobs: H3Job[];
  preflights: Map<string, GenerationPreflight>;
  busy: boolean;
  onClear: () => void;
  onGenerate: (shots: ShotPlan[], preflights: Map<string, GenerationPreflight>,
    reason: string | null) => Promise<boolean>;
  onSetup: () => void;
}

export function CanvasBatchBar({ shots, jobs, preflights, busy, onClear,
  onGenerate, onSetup }: CanvasBatchBarProps) {
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [reason, setReason] = useState('');
  const readiness = useMemo(() => selectBatchReadiness(
    shots, preflights, jobs), [jobs, preflights, shots]);
  const setupRequired = readiness.blocked.some((shotId) => {
    const code = preflights.get(shotId)?.blocking_error?.code;
    return code === 'LOCK_REQUIRED' || code === 'BRIEF_REQUIRED';
  });

  useEffect(() => {
    if (!overrideOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOverrideOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [overrideOpen]);

  const submit = async (overrideReason: string | null) => {
    if (await onGenerate(shots, preflights, overrideReason)) {
      setOverrideOpen(false); setReason(''); onClear();
    }
  };
  const trigger = () => {
    if (setupRequired) { onSetup(); return; }
    if (!readiness.can_submit || busy) return;
    if (readiness.gate_override.length > 0) setOverrideOpen(true);
    else void submit(null);
  };
  const submitOverride = (event: FormEvent) => {
    event.preventDefault();
    if (reason.trim()) void submit(reason.trim());
  };

  return <aside aria-label="批量 H3 生成" className="canvas-batch-bar nodrag nopan">
    <div><span>已选择</span><strong>{shots.length} 镜</strong></div>
    <div className="canvas-batch-summary">
      <span data-tone="ready">可生成 {readiness.ready.length}</span>
      {readiness.blocked.length ? <span data-tone="blocked">
        阻塞 {readiness.blocked.length}</span> : null}
      {readiness.active.length ? <span data-tone="active">
        进行中 {readiness.active.length}</span> : null}
    </div>
    <button className="button compact" onClick={onClear} type="button">清除选择</button>
    <button className="button button-primary compact"
      disabled={busy || (!readiness.can_submit && !setupRequired)}
      onClick={trigger} type="button">
      {setupRequired ? '完善制作条件' : `批量生成 ${shots.length} 镜`}
    </button>
    {overrideOpen ? createPortal(<div className="modal-backdrop" role="presentation">
      <form aria-label="批量代表 Take 门禁原因" aria-modal="true"
        className="generation-modal" onSubmit={submitOverride} role="dialog">
        <span className="eyebrow">BATCH REPRESENTATIVE GATE</span>
        <h3>为什么批量跳过代表 Take 门禁？</h3>
        <p>{readiness.gate_override.length} 个镜头已有生成记录，但还没有获批的代表 Take。原因会写入每个新任务。</p>
        <textarea autoFocus maxLength={1000} required value={reason}
          onChange={(event) => setReason(event.target.value)} />
        <footer><button onClick={() => setOverrideOpen(false)} type="button">取消</button>
          <button className="button-primary" disabled={busy || !reason.trim()}
            type="submit">原子创建全部任务</button></footer>
      </form>
    </div>, document.body) : null}
  </aside>;
}
