interface CanvasViewportToolbarProps {
  sceneLabel: string;
  sceneIsolated: boolean;
  focusMode: boolean;
  browserFullscreen: boolean;
  browserFullscreenBusy: boolean;
  assetDrawerOpen: boolean;
  onToggleAssetDrawer: () => void;
  onFocusScene: () => void;
  onFitOverview: () => void;
  onToggleFocusMode: () => void;
  onToggleBrowserFullscreen: () => void;
}

export function CanvasViewportToolbar({ sceneLabel, sceneIsolated, focusMode,
  browserFullscreen,
  browserFullscreenBusy, assetDrawerOpen, onToggleAssetDrawer, onFocusScene, onFitOverview,
  onToggleFocusMode, onToggleBrowserFullscreen }: CanvasViewportToolbarProps) {
  return <div className="canvas-viewport-toolbar" role="toolbar"
    aria-label="画布视图工具">
    <span className="canvas-scene-chip">{sceneLabel}</span>
    <button aria-label={assetDrawerOpen ? '关闭资产抽屉' : '打开资产抽屉'}
      aria-pressed={assetDrawerOpen} onClick={onToggleAssetDrawer}
      title={assetDrawerOpen ? '关闭资产抽屉' : '打开资产抽屉'} type="button">
      <b aria-hidden="true">▦</b><span className="canvas-tool-label">资产</span>
    </button>
    <button aria-label="聚焦当前场景" aria-pressed={sceneIsolated}
      onClick={onFocusScene} title="进入当前场景导演视图" type="button">
      <b aria-hidden="true">⌖</b><span className="canvas-tool-label">
        {sceneIsolated ? '场景导演' : '当前场景'}</span>
    </button>
    <button aria-label="显示画布全景" onClick={onFitOverview}
      title="显示画布全景" type="button">
      <b aria-hidden="true">⊞</b><span className="canvas-tool-label">全景</span>
    </button>
    <button aria-label={focusMode ? '退出画布专注模式' : '进入画布专注模式'}
      aria-pressed={focusMode} disabled={browserFullscreenBusy}
      onClick={onToggleFocusMode}
      title="画布专注模式 · F" type="button">
      <b aria-hidden="true">{focusMode ? '↙' : '↗'}</b>
      <span className="canvas-tool-label">{focusMode ? '退出专注' : '专注画布'}</span>
      <kbd>F</kbd>
    </button>
    <button aria-label={browserFullscreen
      ? '退出浏览器全屏' : '进入浏览器全屏'} aria-pressed={browserFullscreen}
      className="canvas-browser-fullscreen" disabled={browserFullscreenBusy}
      onClick={onToggleBrowserFullscreen}
      title="浏览器全屏" type="button">
      <b aria-hidden="true">{browserFullscreen ? '⊙' : '⛶'}</b>
      <span className="canvas-tool-label">浏览器全屏</span>
    </button>
  </div>;
}
