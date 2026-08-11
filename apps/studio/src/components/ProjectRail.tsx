import type { Project, ProjectSnapshot } from '@h3storyboard/protocol';

interface ProjectRailProps {
  projects: Project[];
  snapshot: ProjectSnapshot | null;
  selectedShotId: string | null;
  busy: boolean;
  onSelectProject: (id: string) => void;
  onSelectShot: (id: string) => void;
}

function groupShots(snapshot: ProjectSnapshot | null) {
  const scenes = new Map<string, ProjectSnapshot['shot_plans']>();
  for (const shot of snapshot?.shot_plans ?? []) {
    const group = scenes.get(shot.scene_id) ?? [];
    group.push(shot);
    scenes.set(shot.scene_id, group);
  }
  return [...scenes.entries()];
}

export function ProjectRail({
  projects,
  snapshot,
  selectedShotId,
  busy,
  onSelectProject,
  onSelectShot,
}: ProjectRailProps) {
  const actualShotIds = new Set(snapshot?.shot_actuals.map((item) => item.shot_plan_id));
  const scenes = groupShots(snapshot);

  return (
    <aside className="project-rail" aria-label="项目与分镜导航">
      <section className="rail-section project-switcher">
        <div className="section-heading">
          <span>项目库</span>
          <em>{String(projects.length).padStart(2, '0')}</em>
        </div>
        <div className="project-list">
          {projects.length === 0 ? (
            <p className="rail-empty">还没有本地项目</p>
          ) : (
            projects.map((project) => (
              <button
                className="project-row"
                data-active={snapshot?.project.id === project.id}
                disabled={busy}
                key={project.id}
                onClick={() => onSelectProject(project.id)}
                type="button"
              >
                <span className="project-monogram">{project.title.slice(0, 1)}</span>
                <span>
                  <strong>{project.title}</strong>
                  <small>{project.status === 'active' ? '制作中' : '已归档'}</small>
                </span>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="rail-section scene-browser">
        <div className="section-heading">
          <span>场 / 镜</span>
          <em>{String(snapshot?.shot_plans.length ?? 0).padStart(2, '0')}</em>
        </div>
        {!snapshot ? <p className="rail-empty">打开项目后查看场次</p> : null}
        {snapshot && scenes.length === 0 ? (
          <p className="rail-empty">脚本已锁定，等待拆解第一镜</p>
        ) : null}
        <nav className="scene-tree" aria-label="分镜列表">
          {scenes.map(([sceneId, shots], sceneIndex) => (
            <div className="scene-group" key={sceneId}>
              <div className="scene-label">
                <span>SC {String(sceneIndex + 1).padStart(2, '0')}</span>
                <strong>{sceneId}</strong>
              </div>
              {shots.map((shot) => (
                <button
                  className="shot-row"
                  data-active={selectedShotId === shot.id}
                  key={shot.id}
                  onClick={() => onSelectShot(shot.id)}
                  type="button"
                >
                  <span>{String(shot.ordinal).padStart(2, '0')}</span>
                  <strong>{shot.title}</strong>
                  <i
                    className={actualShotIds.has(shot.id) ? 'dot actual' : 'dot planned'}
                    title={actualShotIds.has(shot.id) ? '已有实测' : '仅计划'}
                  />
                </button>
              ))}
            </div>
          ))}
        </nav>
      </section>
    </aside>
  );
}
