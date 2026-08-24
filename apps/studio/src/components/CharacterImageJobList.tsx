import type { CharacterImageJob } from '@h3storyboard/protocol';
import { CHARACTER_IMAGE_OPERATION_LABELS } from
  '../lib/character-image-form.js';
import { isCharacterImageJobActive } from
  '../lib/use-character-image-jobs.js';

interface CharacterImageJobListProps {
  jobs: CharacterImageJob[];
  busy: boolean;
  onRetry: (jobId: string) => void;
  onCancel: (jobId: string) => void;
}

const RETRYABLE = new Set(['failed', 'canceled', 'timed_out']);

export function CharacterImageJobList({ jobs, busy, onRetry,
  onCancel }: CharacterImageJobListProps) {
  if (jobs.length === 0) return null;
  return <section className="character-image-jobs" aria-label="角色图任务">
    <header><span>IMAGE JOBS</span><b>{jobs.length}</b></header>
    <div>{jobs.map((job) => <article key={job.id}
      className="character-image-job" data-status={job.status}>
      <header><span>{CHARACTER_IMAGE_OPERATION_LABELS[job.operation]}</span>
        <i>{job.status}</i></header>
      <small>{job.engine} · SEED {job.seed} · REQUEST {job.width}×{job.height}
        {job.denoise === null ? '' : ` · DENOISE ${job.denoise}`}</small>
      {job.status === 'completed' ? <p>候选已生成 · 等待人工批准</p> : null}
      {job.error_code ? <p className="character-image-job-error">
        <b>{job.error_code}</b>{job.error_message ? ` · ${job.error_message}` : ''}
      </p> : null}
      {job.status === 'canceled' && job.cancel_reason ? <p>
        {job.cancel_reason}</p> : null}
      {isCharacterImageJobActive(job.status) || RETRYABLE.has(job.status)
        ? <footer>{isCharacterImageJobActive(job.status) ? <button type="button"
          disabled={busy} aria-label={`取消角色图任务 ${job.id}`}
          onClick={() => onCancel(job.id)}>取消</button> : null}
        {RETRYABLE.has(job.status) ? <button type="button" disabled={busy}
          aria-label={`重试角色图任务 ${job.id}`}
          onClick={() => onRetry(job.id)}>重试</button> : null}</footer> : null}
    </article>)}</div>
  </section>;
}
