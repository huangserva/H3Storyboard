import { useState } from 'react';
import { AppHeader } from './components/AppHeader.js';
import { DirectorWorkspace } from './components/DirectorWorkspace.js';
import { ProjectComposer } from './components/ProjectComposer.js';
import { ProjectRail } from './components/ProjectRail.js';
import { ShotPlanForm } from './components/ShotPlanForm.js';
import { ModeRegistryPanel } from './components/ModeRegistryPanel.js';
import { useStudio } from './lib/use-studio.js';

export function App() {
  const studio = useStudio();
  const [projectComposerOpen, setProjectComposerOpen] = useState(false);
  const [shotComposerOpen, setShotComposerOpen] = useState(false);
  const [modesOpen, setModesOpen] = useState(false);
  const suggestedScene =
    studio.selectedShot?.scene_id ?? studio.snapshot?.shot_plans.at(-1)?.scene_id ?? 'SCENE-01';

  return (
    <div className="app-shell">
      <AppHeader
        onNewProject={() => setProjectComposerOpen(true)}
        onOpenModes={() => setModesOpen(true)}
        projectTitle={studio.snapshot?.project.title}
        scriptVersion={studio.snapshot?.script_version.version}
      />

      <main className="studio-layout">
        <ProjectRail
          busy={studio.busy}
          onSelectProject={(id) => void studio.selectProject(id)}
          onSelectShot={studio.selectShot}
          projects={studio.projects}
          selectedShotId={studio.selectedShotId}
          snapshot={studio.snapshot}
        />
        <DirectorWorkspace
          busy={studio.busy}
          onNewShot={() => setShotComposerOpen(true)}
          onSelectShot={studio.selectShot}
          onUpdateShot={studio.updateShot}
          onMarkRepresentative={studio.markRepresentative}
          onReviewRepresentative={studio.reviewRepresentative}
          onReviewActual={studio.reviewActual}
          selectedShot={studio.selectedShot}
          snapshot={studio.snapshot}
        />
      </main>

      {projectComposerOpen ? (
        <ProjectComposer
          busy={studio.busy}
          onClose={() => setProjectComposerOpen(false)}
          onCreate={studio.addProject}
        />
      ) : null}
      {shotComposerOpen && studio.snapshot ? (
        <ShotPlanForm
          busy={studio.busy}
          onClose={() => setShotComposerOpen(false)}
          onCreate={studio.addShot}
          suggestedScene={suggestedScene}
        />
      ) : null}
      {modesOpen ? <ModeRegistryPanel onClose={() => setModesOpen(false)} /> : null}
      {studio.notice ? (
        <button
          aria-live="polite"
          className="toast"
          data-tone={studio.notice.tone}
          onClick={studio.dismissNotice}
          type="button"
        >
          <span>{studio.notice.tone === 'success' ? '✓' : '!'}</span>
          {studio.notice.text}
        </button>
      ) : null}
      {studio.busy ? <div className="progress-bar" aria-label="正在处理" /> : null}
    </div>
  );
}
