import { useCallback, useState } from 'react';
import type { PlanReview, UpdateDraftShotPlanInput } from '@h3storyboard/protocol';
import { PlanReviewShotCard } from './PlanReviewShotCard.js';

interface PlanReviewPanelProps {
  archived: boolean;
  busy: boolean;
  review: PlanReview;
  onApprove: () => Promise<unknown>;
  onOpenCanvas: () => void;
  onUpdate: (shotId: string,
    input: UpdateDraftShotPlanInput) => Promise<unknown>;
}

export function PlanReviewPanel({ archived, busy, review, onApprove,
  onOpenCanvas, onUpdate }: PlanReviewPanelProps) {
  const draft = review.compilation.status === 'draft' && !archived;
  const active = review.compilation.status === 'approved' &&
    review.active_compilation_id === review.compilation.id;
  const changed = review.items.filter(({ change }) =>
    change.kind === 'changed').length;
  const added = review.items.filter(({ change }) =>
    change.kind === 'added').length;
  const [dirtyShots, setDirtyShots] = useState<Set<string>>(() => new Set());
  const onDirtyChange = useCallback((shotId: string, dirty: boolean) => {
    setDirtyShots((current) => {
      const next = new Set(current);
      if (dirty) next.add(shotId); else next.delete(shotId);
      return next;
    });
  }, []);
  return <section className="plan-review" aria-label="分镜审核台">
    <header className="plan-review-header">
      <div><span className="eyebrow">P2.2 / PLAN REVIEW</span>
        <h2>{draft ? '逐镜审核生成计划' : active
          ? '执行计划已批准' : '历史计划集'}</h2>
        <p>{review.items.length} 镜 · 新增 {added} · 变化 {changed} · 删除候选 {
          review.removed_shot_plans.length} · REV {review.compilation.revision}</p>
      </div>
      <div className="script-actions">
        <button className="button" type="button" onClick={onOpenCanvas}>
          {archived ? '查看当前画布' : '查看画布'}</button>
        {draft ? <button className="button button-primary" type="button"
          disabled={busy || !review.can_approve || dirtyShots.size > 0}
          onClick={() => void onApprove()}>批准整套分镜</button> :
          <span className="plan-review-approved">{archived
            ? 'ARCHIVED PLAN SET' : active
              ? 'ACTIVE PLAN SET' : 'SUPERSEDED PLAN SET'}</span>}
      </div>
    </header>
    {dirtyShots.size > 0 ? <p className="plan-review-save-warning" role="status">
      还有 {dirtyShots.size} 个镜头未保存，保存后才能批准整套分镜。</p> : null}
    {review.removed_shot_plans.length > 0 ? <aside className="plan-review-removed">
      <strong>批准后将被替代</strong>
      {review.removed_shot_plans.map((shot) => <span key={shot.id}>
        {shot.scene_id} · {shot.title}</span>)}
    </aside> : null}
    <div className="plan-review-list">
      {review.items.map((item) => <PlanReviewShotCard key={item.shot_plan.id}
        item={item} disabled={busy || !draft}
        compilationRevision={review.compilation.revision}
        onDirtyChange={onDirtyChange} onSave={onUpdate} />)}
    </div>
  </section>;
}
