import { lazy, Suspense, useState } from 'react';
import type { GenerationPreflight, ProjectSnapshot, ShotPlan,
  UpdateShotPlanInput } from '@h3storyboard/protocol';
import { ActualShotPanel } from './ActualShotPanel.js';
import { PlannedShotPanel } from './PlannedShotPanel.js';
import { ProductionBoardView } from './ProductionBoardView.js';
import { ReferencePanel } from './ReferencePanel.js';
import { TaskDrawer } from './TaskDrawer.js';
import { ShotProductionEditor } from './ShotProductionEditor.js';
import { useGenerationPreflights } from '../lib/use-generation-preflights.js';

const ProductionBriefPanel = lazy(async () => {
  const module = await import('./ProductionBriefPanel.js');
  return { default: module.ProductionBriefPanel };
});
const InfiniteCanvas = lazy(async () => {
  const module = await import('./InfiniteCanvas.js');
  return { default: module.InfiniteCanvas };
});

interface DirectorWorkspaceProps {
  snapshot: ProjectSnapshot | null;
  selectedShot: ShotPlan | null;
  shotFocusRevision: number;
  busy: boolean;
  onNewShot: () => void;
  onSelectShot: (id: string) => void;
  onUpdateShot: (input: UpdateShotPlanInput) => Promise<boolean>;
  onMarkRepresentative: (actualId: string, representative: boolean) => Promise<boolean>;
  onReviewRepresentative: (actualId: string,
    status: 'approved' | 'rejected') => Promise<boolean>;
  onReviewActual: (actualId: string,
    verdict: 'approved' | 'rejected') => Promise<boolean>;
  onGenerate: (shot: ShotPlan, preflight: GenerationPreflight,
    gateOverrideReason: string | null) => Promise<boolean>;
}

export function DirectorWorkspace({
  snapshot,
  selectedShot,
  shotFocusRevision,
  busy,
  onNewShot,
  onSelectShot,
  onUpdateShot,
  onMarkRepresentative,
  onReviewRepresentative,
  onReviewActual,
  onGenerate,
}: DirectorWorkspaceProps) {
  const [view, setView] = useState<'board' | 'flow' | 'director'>('board');
  const [productionOpen, setProductionOpen] = useState(false);
  const [shotProductionOpen, setShotProductionOpen] = useState(false);
  const [selectedActualId, setSelectedActualId] = useState<string | null>(null);
  const [preflightRevision, setPreflightRevision] = useState(0);
  const preflights = useGenerationPreflights(snapshot, preflightRevision);
  const actuals = snapshot?.shot_actuals.filter(
    (actual) => actual.shot_plan_id === selectedShot?.id,
  ) ?? [];
  const currentActual = actuals.reduce<null | (typeof actuals)[number]>(
    (latest, actual) =>
      !latest || actual.attempt_number > latest.attempt_number ? actual : latest,
    null,
  );
  const displayedActual = actuals.find(({ id }) => id === selectedActualId)
    ?? currentActual;
  const shotJobs = (snapshot?.h3_jobs ?? []).filter(
    ({ shot_plan_id }) => shot_plan_id === selectedShot?.id);
  const displayedJob = displayedActual
    ? shotJobs.find(({ id }) => id === displayedActual.job_id) ?? null
    : shotJobs.at(-1) ?? null;
  const outputAsset = snapshot?.assets.find(
    ({ id }) => id === displayedActual?.output_asset_id) ?? null;

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
            <button data-active={view === 'board'} onClick={() => setView('board')}
              type="button">制片墙</button>
            <button data-active={view === 'flow'} onClick={() => setView('flow')}
              type="button">血缘流程</button>
            <button data-active={view === 'director'} onClick={() => setView('director')} type="button">计划 / 实测</button>
          </div>
          <button className="button compact" type="button"
            onClick={() => setProductionOpen(true)}>BRIEF / LOCK</button>
          <button className="button compact" disabled={!selectedShot} type="button"
            onClick={() => setShotProductionOpen(true)}>INPUTS / STATES</button>
          <button className="button button-primary compact" disabled={busy} onClick={onNewShot} type="button">＋ 新增计划镜头</button>
        </div>
      </header>

      {view === 'board' ? <ProductionBoardView snapshot={snapshot}
        selectedShotId={selectedShot?.id ?? null} busy={busy}
        preflights={preflights} onSelectShot={onSelectShot}
        onGenerate={onGenerate} onSetup={() => setProductionOpen(true)} />
        : view === 'flow' ? (
        <Suspense fallback={<div className="progress-bar" />}>
          <InfiniteCanvas busy={busy} onNewShot={onNewShot}
            onSelectShot={onSelectShot}
            selectedShotId={selectedShot?.id ?? null} snapshot={snapshot}
            shotFocusRevision={shotFocusRevision}
            preflights={preflights} onGenerate={onGenerate}
            onSetup={() => setProductionOpen(true)}
            onReviewActual={onReviewActual}
            onMarkRepresentative={onMarkRepresentative}
            onReviewRepresentative={onReviewRepresentative} />
        </Suspense>
      ) : <div className="director-grid">
        <div className="comparison-grid">
          <PlannedShotPanel busy={busy} shot={selectedShot}
            job={displayedJob} preflight={selectedShot
              ? preflights.get(selectedShot.id) ?? null : null}
            onGenerate={(reason) => selectedShot
              ? onGenerate(selectedShot, preflights.get(selectedShot.id)!, reason)
              : Promise.resolve(false)}
            onSetup={() => setProductionOpen(true)} />
          <ActualShotPanel actual={displayedActual} busy={busy}
            actuals={actuals}
            hasSelectedShot={Boolean(selectedShot)}
            outputAsset={outputAsset}
            onReviewActual={onReviewActual}
            onSelectActual={setSelectedActualId}
            onMarkRepresentative={onMarkRepresentative}
            onReviewRepresentative={onReviewRepresentative} />
        </div>
        <ReferencePanel shot={selectedShot} />
      </div>}
      {view === 'director' ? <TaskDrawer actual={displayedActual}
        job={displayedJob} shot={selectedShot} /> : null}
      {productionOpen ? <Suspense fallback={<div className="progress-bar" />}>
        <ProductionBriefPanel projectId={snapshot.project.id}
          onClose={() => { setProductionOpen(false);
            setPreflightRevision((value) => value + 1); }} />
      </Suspense> : null}
      {shotProductionOpen && selectedShot ? <ShotProductionEditor
        busy={busy} projectId={snapshot.project.id} shot={selectedShot}
        onClose={() => setShotProductionOpen(false)} onSave={onUpdateShot} /> : null}
    </section>
  );
}
