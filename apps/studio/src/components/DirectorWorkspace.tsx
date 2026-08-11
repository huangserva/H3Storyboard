import { useState } from 'react';
import type { ProjectSnapshot, ShotPlan } from '@h3storyboard/protocol';
import { ActualShotPanel } from './ActualShotPanel.js';
import { InfiniteCanvas } from './InfiniteCanvas.js';
import { PlannedShotPanel } from './PlannedShotPanel.js';
import { ReferencePanel } from './ReferencePanel.js';
import { TaskDrawer } from './TaskDrawer.js';

interface DirectorWorkspaceProps {
  snapshot: ProjectSnapshot | null;
  selectedShot: ShotPlan | null;
  busy: boolean;
  onNewShot: () => void;
  onSelectShot: (id: string) => void;
}

export function DirectorWorkspace({
  snapshot,
  selectedShot,
  busy,
  onNewShot,
  onSelectShot,
}: DirectorWorkspaceProps) {
  const [view, setView] = useState<'director' | 'canvas'>('canvas');
  const actuals = snapshot?.shot_actuals.filter(
    (actual) => actual.shot_plan_id === selectedShot?.id,
  ) ?? [];
  const currentActual = actuals.reduce<null | (typeof actuals)[number]>(
    (latest, actual) =>
      !latest || actual.attempt_number > latest.attempt_number ? actual : latest,
    null,
  );

  if (!snapshot) {
    return (
      <section className="no-project-view">
        <div className="frame-corners" aria-hidden="true" />
        <span className="eyebrow">DIRECTOR WORKBENCH / M0</span>
        <h1>让计划与结果<br />始终是两件事。</h1>
        <p>从左侧打开项目，或建立完整剧本。计划分镜不会被生成结果覆盖，每个 Take 都保留独立记录。</p>
        <div className="workflow-line" aria-label="工作流">
          <span>剧本锁定</span><i />
          <span>计划分镜</span><i />
          <span>H3 生成</span><i />
          <span>实测 QC</span>
        </div>
      </section>
    );
  }

  return (
    <section className="workbench">
      <header className="workbench-toolbar">
        <div>
          <span className="eyebrow">SCENE / SHOT WORKSPACE</span>
          <strong>{selectedShot ? `${selectedShot.scene_id} · SHOT ${String(selectedShot.ordinal).padStart(2, '0')}` : '等待分镜'}</strong>
        </div>
        <div className="legend">
          <div className="view-switcher" aria-label="工作区视图">
            <button data-active={view === 'canvas'} onClick={() => setView('canvas')} type="button">画布</button>
            <button data-active={view === 'director'} onClick={() => setView('director')} type="button">计划 / 实测</button>
          </div>
          <button className="button button-primary compact" disabled={busy} onClick={onNewShot} type="button">＋ 新增计划镜头</button>
        </div>
      </header>

      {view === 'canvas' ? (
        <InfiniteCanvas busy={busy} onNewShot={onNewShot} onSelectShot={onSelectShot}
          selectedShotId={selectedShot?.id ?? null} snapshot={snapshot} />
      ) : <div className="director-grid">
        <div className="comparison-grid">
          <PlannedShotPanel shot={selectedShot} />
          <ActualShotPanel actual={currentActual} hasSelectedShot={Boolean(selectedShot)} />
        </div>
        <ReferencePanel shot={selectedShot} />
      </div>}
      {view === 'director' ? <TaskDrawer actual={currentActual} shot={selectedShot} /> : null}
    </section>
  );
}
