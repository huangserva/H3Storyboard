import { useEffect, useMemo, useState } from 'react';
import type { Asset, GenerationPreflight, ProjectSnapshot, ShotPlan } from
  '@h3storyboard/protocol';
import { selectProductionScenes } from '../lib/production-board-selectors.js';
import * as api from '../lib/api.js';
import { useCharacterImageJobs } from '../lib/use-character-image-jobs.js';
import { useCharacters } from '../lib/use-characters.js';
import { CharacterImageGenerationPanel } from './CharacterImageGenerationPanel.js';
import { MediaLightbox } from './MediaLightbox.js';
import { ProductionCharacterCard } from './ProductionCharacterCard.js';
import { ProductionSceneSection } from './ProductionSceneSection.js';

interface ProductionBoardViewProps {
  snapshot: ProjectSnapshot;
  selectedShotId: string | null;
  busy: boolean;
  preflights: Map<string, GenerationPreflight>;
  onSelectShot: (id: string) => void;
  onGenerate: (shot: ShotPlan, preflight: GenerationPreflight,
    reason: string | null) => Promise<boolean>;
  onSetup: () => void;
}

interface ManifestNotice { manifest_stale: boolean }

export function ProductionBoardView({ snapshot, selectedShotId, busy,
  preflights, onSelectShot, onGenerate, onSetup }: ProductionBoardViewProps) {
  const characterStore = useCharacters(snapshot.project.id);
  const imageJobStore = useCharacterImageJobs(snapshot.project.id);
  const scenes = useMemo(() => selectProductionScenes(snapshot), [snapshot]);
  const [lightboxAssetId, setLightboxAssetId] = useState<string | null>(null);
  const [generatorCharacterId, setGeneratorCharacterId] = useState<string | null>(null);
  const [manifestNotice, setManifestNotice] = useState<ManifestNotice | null>(null);
  const [freezeBusy, setFreezeBusy] = useState(false);
  const [freezeError, setFreezeError] = useState<string | null>(null);
  const assets = useMemo(() => mergeAssets(
    snapshot.assets, characterStore.referenceAssets),
  [snapshot.assets, characterStore.referenceAssets]);
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])),
    [assets]);
  const lightboxAsset = lightboxAssetId ? assetById.get(lightboxAssetId) ?? null : null;
  const generatorCharacter = generatorCharacterId
    ? characterStore.characters.find(({ id }) => id === generatorCharacterId) ?? null
    : null;
  const completedOutputIds = useMemo(() => imageJobStore.jobs.flatMap((job) =>
    job.status === 'completed' && job.output_asset_id ? [job.output_asset_id] : []),
  [imageJobStore.jobs]);
  const completed = snapshot.h3_jobs.filter(({ status }) => status === 'completed').length;
  const pendingQc = snapshot.shot_actuals.filter(
    ({ qc_verdict }) => qc_verdict === 'pending').length;
  const imageActive = imageJobStore.jobs.filter(({ status }) =>
    ['draft', 'submitting', 'queued', 'running'].includes(status)).length;

  useEffect(() => {
    if (completedOutputIds.some((outputId) =>
      !characterStore.referenceAssets.some(({ id }) => id === outputId))) {
      void characterStore.reload();
    }
  }, [characterStore.referenceAssets, characterStore.reload, completedOutputIds]);

  useEffect(() => {
    setGeneratorCharacterId(null);
    setManifestNotice(null);
    setFreezeError(null);
  }, [snapshot.project.id]);

  const freezeManifest = async () => {
    setFreezeBusy(true);
    try {
      await api.freezeAssetManifest(snapshot.project.id);
      setManifestNotice(null);
      setFreezeError(null);
    } catch (error) {
      setFreezeError(error instanceof api.ApiError
        ? `${error.message} · ${error.code}` : '冻结 CURRENT-ASSETS 失败');
    } finally {
      setFreezeBusy(false);
    }
  };

  return <><main className="production-board" aria-label="制片墙">
    <header className="production-board-summary">
      <div><span>PRODUCTION BOARD</span><h1>{snapshot.project.title}</h1></div>
      <dl><div><dt>CAST</dt><dd>{characterStore.characters.length}</dd></div>
        <div><dt>SHOTS</dt><dd>{snapshot.shot_plans.length}</dd></div>
        <div><dt>H3 DONE</dt><dd>{completed}</dd></div>
        <div><dt>IMAGE ACTIVE</dt><dd>{imageActive}</dd></div>
        <div><dt>QC PENDING</dt><dd>{pendingQc}</dd></div></dl>
    </header>
    {characterStore.error || imageJobStore.error || freezeError
      ? <p className="production-board-error" role="alert">
        {characterStore.error ?? imageJobStore.error ?? freezeError}</p> : null}
    {manifestNotice ? <aside className="production-manifest-notice" role="status">
      <div><b>APPROVAL RESULT</b><span>manifest_stale = {
        String(manifestNotice.manifest_stale)}</span><p>批准只更新资产状态；
        冻结后 H3 才能使用新的 CURRENT-ASSETS。</p></div>
      <button className="button button-accent" disabled={freezeBusy}
        onClick={() => void freezeManifest()} type="button">
        {freezeBusy ? '冻结中…' : '冻结 CURRENT-ASSETS'}</button></aside> : null}
    <section className="production-cast" aria-labelledby="production-cast-heading">
      <header><div><span>IDENTITY FIRST</span><h2 id="production-cast-heading">
        角色圣经</h2></div><p>候选图不会自动进入 H3；先人工批准，再冻结 manifest。</p></header>
      <div className="production-character-strip">
        {characterStore.characters.filter(({ status }) => status !== 'archived')
          .map((character) => <ProductionCharacterCard key={character.id}
            character={character}
            busy={busy || characterStore.busy || imageJobStore.busy}
            references={characterStore.references.filter(
              ({ character_id }) => character_id === character.id)}
            imageJobs={imageJobStore.jobs.filter(
              ({ character_id }) => character_id === character.id)}
            assetById={assetById} onOpenMedia={setLightboxAssetId}
            onUpload={(file, derivedFrom) => void characterStore.uploadReference(
              character.id, file, derivedFrom)}
            onApprove={(referenceId, makePrimary) => { void (async () => {
              const result = await characterStore.approveReference(
                character.id, referenceId, makePrimary);
              if (result) setManifestNotice({ manifest_stale: result.manifest_stale });
            })(); }}
            onArchive={(assetId) => void characterStore.archiveReference(assetId)}
            onOpenGenerator={() => setGeneratorCharacterId(character.id)}
            onRetryImageJob={(jobId) => void imageJobStore.retry(jobId)}
            onCancelImageJob={(jobId) => void imageJobStore.cancel(jobId)} />)}
        {characterStore.characters.length === 0 ? <div className="production-cast-empty">
          先在血缘流程右侧角色库建立角色，再回到制片墙上传母图。</div> : null}
      </div>
    </section>
    <div className="production-scenes">
      {scenes.map((scene) => <ProductionSceneSection key={scene.scene_id}
        scene={scene} preflights={preflights} selectedShotId={selectedShotId}
        busy={busy} onSelectShot={onSelectShot} onSetup={onSetup}
        onOpenMedia={setLightboxAssetId} onGenerate={async (shotId, reason) => {
          const shot = snapshot.shot_plans.find(({ id }) => id === shotId);
          const preflight = preflights.get(shotId);
          return shot && preflight ? onGenerate(shot, preflight, reason) : false;
        }} />)}
    </div>
    {lightboxAsset ? <MediaLightbox asset={lightboxAsset}
      onClose={() => setLightboxAssetId(null)} /> : null}
  </main>{generatorCharacter ? <CharacterImageGenerationPanel
    key={generatorCharacter.id} character={generatorCharacter}
    references={characterStore.references.filter(
      ({ character_id }) => character_id === generatorCharacter.id)}
    assetById={assetById} busy={imageJobStore.busy}
    onClose={() => setGeneratorCharacterId(null)}
    onCreate={(input) => imageJobStore.create(generatorCharacter.id, input)} /> : null}</>;
}

function mergeAssets(snapshotAssets: Asset[], localAssets: Asset[]): Asset[] {
  const byId = new Map(snapshotAssets.map((asset) => [asset.id, asset]));
  for (const asset of localAssets) byId.set(asset.id, asset);
  return [...byId.values()];
}
