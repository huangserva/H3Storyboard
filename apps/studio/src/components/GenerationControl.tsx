import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import type { GenerationPreflight, H3Job } from '@h3storyboard/protocol';

interface GenerationControlProps {
  compact?: boolean;
  busy: boolean;
  job: H3Job | null;
  preflight: GenerationPreflight | null;
  onGenerate: (overrideReason: string | null) => Promise<boolean>;
  onSetup: () => void;
}

const stageByStatus: Record<H3Job['status'], string> = {
  draft: 'QUEUED · 等待 worker', submitting: 'CLAIMED · 正在提交',
  queued: 'SUBMITTED · Provider 已接收', running: 'POLLING · 正在生成',
  completed: 'COMPLETED · 新 Take 已就绪', failed: 'FAILED · 生成失败',
  canceled: 'CANCELED · 已取消', timed_out: 'QUEUED · 等待恢复',
};

export function GenerationControl({ compact = false, busy, job, preflight,
  onGenerate, onSetup }: GenerationControlProps) {
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [reason, setReason] = useState('');
  const active = job && ['draft', 'submitting', 'queued', 'running', 'timed_out']
    .includes(job.status);
  const setupRequired = preflight?.blocking_error?.code === 'LOCK_REQUIRED' ||
    preflight?.blocking_error?.code === 'BRIEF_REQUIRED';
  const disabled = busy || Boolean(active) || !preflight ||
    (!preflight.ready && !setupRequired);
  const label = job ? '新 Take' : '生成';

  useEffect(() => {
    if (!overrideOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOverrideOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [overrideOpen]);

  const trigger = () => {
    if (setupRequired) { onSetup(); return; }
    if (preflight?.gate_override_required) { setOverrideOpen(true); return; }
    void onGenerate(null);
  };
  const submitOverride = async (event: FormEvent) => {
    event.preventDefault();
    if (await onGenerate(reason.trim())) {
      setOverrideOpen(false); setReason('');
    }
  };

  return <div className="generation-control" data-compact={compact}>
    {job ? <span className="job-stage" data-status={job.status}>
      {stageByStatus[job.status]}</span> : null}
    <button className="button button-primary compact" disabled={disabled}
      title={preflight?.blocking_error?.message ?? ''} type="button" onClick={trigger}>
      {active ? '生成中…' : label}</button>
    {preflight?.blocking_error ? <small>{preflight.blocking_error.message}</small> : null}
    {overrideOpen ? createPortal(<div className="modal-backdrop" role="presentation">
      <form aria-label="代表 Take 门禁原因" aria-modal="true"
        className="generation-modal" onSubmit={submitOverride} role="dialog">
        <span className="eyebrow">REPRESENTATIVE GATE</span>
        <h3>为什么需要跳过代表 Take 门禁？</h3>
        <p>该镜头已有生成记录，但还没有获批的代表 Take。原因会随新 job 永久保存。</p>
        <textarea autoFocus maxLength={1000} required value={reason}
          onChange={(event) => setReason(event.target.value)} />
        <footer><button type="button" onClick={() => setOverrideOpen(false)}>取消</button>
          <button className="button-primary" disabled={busy || !reason.trim()}
            type="submit">确认生成新 Take</button></footer>
      </form>
    </div>, document.body) : null}
  </div>;
}
