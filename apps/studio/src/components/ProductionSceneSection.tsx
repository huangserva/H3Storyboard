import type { GenerationPreflight } from '@h3storyboard/protocol';
import { assetFileUrl } from '../lib/api.js';
import type { ProductionSceneProjection } from
  '../lib/production-board-selectors.js';
import { ProductionShotCard } from './ProductionShotCard.js';

interface ProductionSceneSectionProps {
  scene: ProductionSceneProjection;
  preflights: Map<string, GenerationPreflight>;
  selectedShotId: string | null;
  busy: boolean;
  onSelectShot: (id: string) => void;
  onGenerate: (shotId: string, reason: string | null) => Promise<boolean>;
  onSetup: () => void;
  onOpenMedia: (assetId: string) => void;
}

export function ProductionSceneSection({ scene, preflights, selectedShotId,
  busy, onSelectShot, onGenerate, onSetup,
  onOpenMedia }: ProductionSceneSectionProps) {
  return <section className="production-scene" aria-labelledby={`scene-${scene.scene_id}`}>
    <header><div><span>SCENE</span><h2 id={`scene-${scene.scene_id}`}>
      {scene.scene_id}</h2></div><small>{scene.shots.length} SHOTS · {
        scene.assets.length} STAGE ASSETS</small></header>
    <div className="production-scene-assets" aria-label={`${scene.scene_id} 场景素材`}>
      {scene.assets.map(({ asset, usage_count: usageCount }) => <button
        key={asset.id} type="button" className="production-scene-asset"
        onClick={() => onOpenMedia(asset.id)}>
        {asset.kind === 'image' ? <img alt={asset.name} loading="lazy"
          src={assetFileUrl(asset.id)} /> : <span>{asset.kind.toUpperCase()}</span>}
        <i>{asset.status} · USED BY {usageCount}</i>
      </button>)}
      {scene.assets.length === 0 ? <div className="production-scene-empty">
        暂无 reference_stage；镜头仍保持独立计划。</div> : null}
    </div>
    <div className="production-shot-wall">
      {scene.shots.map((projection) => <ProductionShotCard key={projection.shot.id}
        projection={projection} busy={busy} selected={selectedShotId === projection.shot.id}
        preflight={preflights.get(projection.shot.id) ?? null}
        onSelect={() => onSelectShot(projection.shot.id)} onSetup={onSetup}
        onOpenMedia={onOpenMedia} onGenerate={(reason) =>
          onGenerate(projection.shot.id, reason)} />)}
    </div>
  </section>;
}
