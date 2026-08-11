interface AppHeaderProps {
  projectTitle?: string | undefined;
  scriptVersion?: number | undefined;
  onNewProject: () => void;
}

export function AppHeader({
  projectTitle,
  scriptVersion,
  onNewProject,
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="brand-lockup" aria-label="H3Storyboard">
        <span className="brand-mark" aria-hidden="true">
          H3
        </span>
        <div>
          <strong>Storyboard</strong>
          <span>Director Workbench</span>
        </div>
      </div>

      <div className="header-project">
        <span className="eyebrow">当前制作</span>
        <strong>{projectTitle ?? '尚未打开项目'}</strong>
        {scriptVersion ? <span className="version-tag">SCRIPT V{scriptVersion}</span> : null}
      </div>

      <div className="header-actions">
        <span className="local-status">
          <i aria-hidden="true" /> 本地存储
        </span>
        <button className="button button-primary" type="button" onClick={onNewProject}>
          <span aria-hidden="true">＋</span> 新建项目
        </button>
      </div>
    </header>
  );
}
