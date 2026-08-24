import { useEffect, useState } from 'react';
import type { Character, CharacterReference } from '@h3storyboard/protocol';
import { assetFileUrl } from '../lib/api.js';

interface CanvasCharacterCardProps {
  character: Character;
  reference: CharacterReference | null;
  selected: boolean;
  onOpenMedia: (assetId: string) => void;
}

export function CanvasCharacterCard({
  character,
  reference,
  selected,
  onOpenMedia,
}: CanvasCharacterCardProps) {
  const [missing, setMissing] = useState(false);
  useEffect(() => setMissing(false), [reference?.id]);
  const previewAssetId = reference?.kind === 'image' ? reference.asset_id : null;
  return (
    <article
      aria-label={`角色 ${character.name}`}
      className="canvas-character-card"
      data-selected={selected}
    >
      <header><span>CHARACTER</span><i>{character.status}</i></header>
      {previewAssetId && !missing ? <button aria-label={`查看 ${character.name} 参考图`}
        className="canvas-character-preview canvas-media-trigger nodrag nopan"
        onClick={() => onOpenMedia(previewAssetId)} type="button">
        <img alt={`${character.name} approved reference`} loading="lazy"
          onError={() => setMissing(true)} src={assetFileUrl(previewAssetId)} />
      </button> : <div className="character-monogram" aria-hidden="true">
          {character.name.slice(0, 1).toUpperCase()}
        </div>}
      <h3>{character.name}</h3>
      <p>{character.canonical_appearance}</p>
      <footer>SEEDS · {character.seed_family.join(' / ') || 'UNSET'}</footer>
    </article>
  );
}
