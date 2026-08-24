import type { Asset, Character, CharacterReference } from '@h3storyboard/protocol';
import { assetFileUrl } from '../lib/api.js';

interface ProductionCharacterCardProps {
  character: Character;
  references: CharacterReference[];
  assetById: Map<string, Asset>;
  busy: boolean;
  onUpload: (file: File, derivedFrom: string | null) => void;
  onApprove: (referenceId: string, makePrimary: boolean) => void;
  onArchive: (assetId: string) => void;
  onOpenMedia: (assetId: string) => void;
}

export function ProductionCharacterCard({ character, references, assetById,
  busy, onUpload, onApprove, onArchive,
  onOpenMedia }: ProductionCharacterCardProps) {
  const ordered = [...references].sort((left, right) =>
    left.sort_order - right.sort_order || left.created_at.localeCompare(right.created_at));
  const imageReferences = ordered.flatMap((reference) => {
    const asset = reference.asset_id ? assetById.get(reference.asset_id) : null;
    return asset?.kind === 'image' ? [{ reference, asset }] : [];
  });
  const primary = imageReferences.find(({ reference, asset }) =>
    reference.derived_from === null && asset.status === 'approved') ?? null;
  return <article className="production-character-card"
    aria-label={`角色卡 ${character.name}`}>
    <div className="production-character-media">
      {primary ? <button type="button" className="production-media-button"
        aria-label={`查看 ${character.name} approved 母图`}
        onClick={() => onOpenMedia(primary.asset.id)}>
        <img alt={`${character.name} approved 母图`} loading="lazy"
          src={assetFileUrl(primary.asset.id)} />
        <span>APPROVED MASTER</span>
      </button> : <div className="production-character-empty">
        <b>{character.name.slice(0, 1)}</b><span>还没有 approved 母图</span>
      </div>}
    </div>
    <div className="production-character-copy">
      <header><div><span>CAST BIBLE</span><h3>{character.name}</h3></div>
        <i data-status={character.status}>{character.status}</i></header>
      <p>{character.canonical_appearance}</p>
      <small>SEED FAMILY · {character.seed_family.join(' / ') || 'UNSET'}</small>
      <div className="production-reference-grid">
        {imageReferences.map(({ reference, asset }) => <div key={reference.id}
          className="production-reference-thumb" data-status={asset.status}>
          <button type="button" aria-label={`查看 ${character.name} ${asset.status} 参考图`}
            onClick={() => onOpenMedia(asset.id)}>
            <img alt="" loading="lazy" src={assetFileUrl(asset.id)} />
            <span>{reference.derived_from ? 'DERIVED' : 'MASTER'} · {asset.status}</span>
          </button>
          {asset.status !== 'archived' ? <div className="production-reference-actions">
            {asset.status === 'candidate' ? <button type="button" disabled={busy}
              className="production-reference-approve"
              aria-label={`批准 ${character.name} ${asset.name}`}
              onClick={() => onApprove(
                reference.id, reference.derived_from === null)}>批准</button> : null}
            <button type="button" disabled={busy}
              aria-label={`归档 ${character.name} ${asset.name}`}
              onClick={() => onArchive(asset.id)}>归档</button>
          </div> : null}
        </div>)}
        {imageReferences.length === 0 ? <span className="production-empty-note">
          上传候选图后，人工批准才会进入 H3 reference binding。</span> : null}
      </div>
      <footer>
        <label className="button compact production-upload-action">
          上传母图<input accept="image/png,image/jpeg,image/webp" disabled={busy}
            type="file" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUpload(file, null);
              event.target.value = '';
            }} />
        </label>
        <label className="button compact production-upload-action"
          aria-disabled={!primary}>
          上传多角度<input accept="image/png,image/jpeg,image/webp"
            disabled={busy || !primary} type="file" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file && primary) onUpload(file, primary.reference.id);
              event.target.value = '';
            }} />
        </label>
      </footer>
    </div>
  </article>;
}
