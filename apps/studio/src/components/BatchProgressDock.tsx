import { useEffect, useState } from 'react';
import type { ProjectSnapshot } from '@h3storyboard/protocol';
import { useH3JobBatches } from '../lib/use-h3-job-batches.js';

interface BatchProgressDockProps { snapshot: ProjectSnapshot }

const statusLabel = {
  pending: '等待调度', running: '生成中', attention: '需要处理',
  completed: '全部完成',
} as const;

export function BatchProgressDock({ snapshot }: BatchProgressDockProps) {
  const { batches, error, retryingJobId, retry } = useH3JobBatches(
    snapshot.project.id);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const active = batches.filter(({ status }) => status !== 'completed');
  const visible = [...active, ...batches.filter(
    ({ status }) => status === 'completed').slice(0, Math.max(0, 3 - active.length))];
  useEffect(() => {
    const preferred = visible.find(({ status }) => status === 'attention') ??
      visible.find(({ status }) => status !== 'completed') ?? visible[0];
    setExpandedId((current) => visible.some(({ id }) => id === current)
      ? current : preferred?.id ?? null);
  }, [batches]);
  if (visible.length === 0 && !error) return null;

  return <aside aria-label="H3 批次进度" className="batch-progress-dock">
    <header><div><span className="eyebrow">H3 BATCH ORCHESTRATOR</span>
      <strong>跨镜任务</strong></div>
      <small>{visible.filter(({ status }) => status !== 'completed').length}
        {' '}个活跃批次</small></header>
    {error ? <p className="batch-progress-error" role="alert">{error}</p> : null}
    <div className="batch-progress-list">
      {visible.map((batch) => {
        const expanded = batch.id === expandedId;
        return <article data-status={batch.status} key={batch.id}>
          <button aria-expanded={expanded} className="batch-progress-summary"
            onClick={() => setExpandedId(expanded ? null : batch.id)} type="button">
            <span className="batch-progress-state"><i />
              {statusLabel[batch.status]}</span>
            <b>{batch.progress.completed}/{batch.progress.total} 镜</b>
            <span>{batch.progress.progress_percent}%</span>
            <em aria-hidden="true">{expanded ? '−' : '+'}</em>
          </button>
          <div className="batch-progress-track"><i style={{ width:
            `${batch.progress.progress_percent}%` }} /></div>
          <div className="batch-progress-counts">
            <span>等待 {batch.progress.pending}</span>
            <span>运行 {batch.progress.active}</span>
            <span>恢复 {batch.progress.recovering}</span>
            <span data-tone="attention">处理 {batch.progress.attention}</span>
          </div>
          {expanded ? <div className="batch-progress-items">
            {batch.items.map((item) => {
              const shot = snapshot.shot_plans.find(
                ({ id }) => id === item.shot_plan_id);
              const job = item.current_job;
              return <div data-status={job.status} key={item.original_job_id}>
                <span><b>{String(item.ordinal + 1).padStart(2, '0')}</b>
                  <span>{shot?.title ?? `镜头 ${item.ordinal + 1}`}</span></span>
                <small>{job.status}{item.retry_count
                  ? ` · RETRY ${item.retry_count}` : ''}</small>
                {item.retryable ? <button disabled={retryingJobId !== null}
                  onClick={() => void retry(job.id)} type="button">
                  {retryingJobId === job.id ? '重试中…' : `重试 ${shot?.title ?? '此镜'}`}
                </button> : null}
              </div>;
            })}
          </div> : null}
        </article>;
      })}
    </div>
  </aside>;
}
