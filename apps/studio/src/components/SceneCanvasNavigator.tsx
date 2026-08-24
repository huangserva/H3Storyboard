import type { StoryboardSceneSummary } from
  '../lib/storyboard-scene-director.js';

interface SceneCanvasNavigatorProps {
  scenes: StoryboardSceneSummary[];
  activeSceneId: string | null;
  onSelectScene: (sceneId: string | null) => void;
}

export function SceneCanvasNavigator({ scenes, activeSceneId,
  onSelectScene }: SceneCanvasNavigatorProps) {
  return <nav className="scene-canvas-navigator" aria-label="场景导航">
    <div className="scene-canvas-title">
      <span>DIRECTOR CANVAS</span>
      <small>{activeSceneId ? '当前场景生产链' : '全部场景总览'}</small>
    </div>
    <div className="scene-canvas-tabs">
      <button aria-pressed={activeSceneId === null}
        onClick={() => onSelectScene(null)} type="button">
        全部 <i>{scenes.reduce((sum, scene) => sum + scene.shot_count, 0)}</i>
      </button>
      {scenes.map((scene) => <button key={scene.scene_id}
        aria-pressed={activeSceneId === scene.scene_id}
        onClick={() => onSelectScene(scene.scene_id)} type="button">
        {scene.label} <i>{scene.shot_count} 镜</i>
      </button>)}
    </div>
  </nav>;
}
