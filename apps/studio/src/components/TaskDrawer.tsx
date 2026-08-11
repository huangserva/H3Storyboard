import { useState } from 'react';
import type { ShotActual, ShotPlan } from '@h3storyboard/protocol';

interface TaskDrawerProps {
  shot: ShotPlan | null;
  actual: ShotActual | null;
}

const qcItems = ['构图与动作', '角色一致性', '镜头连续性', '视听同步', '技术质量'];

export function TaskDrawer({ shot, actual }: TaskDrawerProps) {
  const [open, setOpen] = useState(true);
  const qcState = actual?.qc_verdict ?? 'pending';
  const qcLabel = qcState === 'approved'
    ? '已通过'
    : qcState === 'rejected'
      ? '已驳回'
      : '待检';
  const stripState = qcState === 'approved'
    ? 'pass'
    : qcState === 'rejected'
      ? 'fail'
      : 'pending';

  return (
    <section className="task-drawer" data-open={open}>
      <button className="drawer-handle" type="button" onClick={() => setOpen((value) => !value)}>
        <span className="eyebrow">TASKS & QUALITY CONTROL</span>
        <span className="drawer-summary">
          <i /> 队列 0&nbsp;&nbsp;·&nbsp;&nbsp; QC {qcLabel}
          <b aria-hidden="true">{open ? '⌄' : '⌃'}</b>
        </span>
      </button>
      {open ? (
        <div className="drawer-content">
          <div className="task-empty">
            <span>QUEUE 00</span>
            <div>
              <strong>{shot ? '尚未提交生成任务' : '请选择计划镜头'}</strong>
              <small>任务会记录排队、运行、失败与每次生成血缘。</small>
            </div>
          </div>
          <div className="qc-strip">
            {qcItems.map((item, index) => (
              <div key={item} data-state={stripState}>
                <span>{stripState === 'pass' ? '✓' : stripState === 'fail' ? '×' : String(index + 1).padStart(2, '0')}</span>
                <small>{item}</small>
              </div>
            ))}
          </div>
          <button className="button button-accent" disabled={!shot} type="button">提交 H3 · M1</button>
        </div>
      ) : null}
    </section>
  );
}
