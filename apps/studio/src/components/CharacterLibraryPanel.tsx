import { useState, type FormEvent } from 'react';
import type {
  Character,
  CreateCharacterInput,
  UpdateCharacterInput,
} from '@h3storyboard/protocol';

interface CharacterLibraryPanelProps {
  characters: Character[];
  canvasCharacterIds: Set<string>;
  busy: boolean;
  error: string | null;
  onCreate: (input: CreateCharacterInput) => Promise<boolean>;
  onUpdate: (input: UpdateCharacterInput) => Promise<boolean>;
  onPlace: (characterId: string) => void;
}

function parseSeeds(value: string): number[] | null {
  if (!value.trim()) return [];
  const seeds = value.split(',').map((item) => Number(item.trim()));
  return seeds.every((seed) => Number.isInteger(seed) && seed >= 0)
    ? seeds : null;
}

export function CharacterLibraryPanel({
  characters, canvasCharacterIds, busy, error, onCreate, onUpdate, onPlace,
}: CharacterLibraryPanelProps) {
  const [editing, setEditing] = useState<Character | 'new' | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [appearance, setAppearance] = useState('');
  const [seeds, setSeeds] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const openEditor = (character: Character | 'new') => {
    setEditing(character);
    setName(character === 'new' ? '' : character.name);
    setAppearance(character === 'new' ? '' : character.canonical_appearance);
    setSeeds(character === 'new' ? '' : character.seed_family.join(', '));
    setLocalError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const seedFamily = parseSeeds(seeds);
    if (seedFamily === null) {
      setLocalError('Seed 族必须是逗号分隔的非负整数');
      return;
    }
    const common = { name: name.trim(), canonical_appearance: appearance.trim(),
      seed_family: seedFamily };
    const saved = editing === 'new'
      ? await onCreate(common)
      : editing ? await onUpdate({ character_id: editing.id, ...common }) : false;
    if (saved) setEditing(null);
  };

  return (
    <aside className="character-library" aria-label="角色库" data-open={open}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}>
      <header><div><span className="eyebrow">CHARACTER BIBLE</span>
        <strong>角色库</strong></div><div className="character-header-actions">
        {open ? <button type="button" onClick={() => openEditor('new')}>＋ 新建</button> : null}
        <button type="button" onClick={() => setOpen((current) => !current)}>
          {open ? '收起' : '角色'}</button></div></header>
      {open ? <>
      {error || localError ? <p className="character-error">{localError ?? error}</p> : null}
      {editing ? <form className="character-form" onSubmit={submit}>
        <label><span>角色名称</span><input required maxLength={160} value={name}
          onChange={(event) => setName(event.target.value)} /></label>
        <label><span>Canonical appearance</span><textarea required value={appearance}
          onChange={(event) => setAppearance(event.target.value)}
          placeholder="English identity description injected verbatim…" /></label>
        <label><span>Seed family</span><input value={seeds}
          onChange={(event) => setSeeds(event.target.value)} placeholder="41, 1041" /></label>
        <footer><button type="button" onClick={() => setEditing(null)}>取消</button>
          <button className="button-primary" disabled={busy} type="submit">保存</button></footer>
      </form> : null}
      <div className="character-list">
        {characters.length === 0 ? <p className="rail-empty">还没有角色定义</p> : null}
        {characters.map((character) => <article key={character.id}
          data-archived={character.status === 'archived'}>
          <header><strong>{character.name}</strong><span>{character.status}</span></header>
          <p>{character.canonical_appearance}</p>
          <small>SEEDS · {character.seed_family.join(' / ') || 'UNSET'}</small>
          <footer><button disabled={character.status === 'archived'} type="button"
            onClick={() => openEditor(character)}>编辑</button>
            <button disabled={character.status === 'archived' || canvasCharacterIds.has(character.id)}
              type="button" onClick={() => onPlace(character.id)}>
              {canvasCharacterIds.has(character.id) ? '已上画布' : '上画布'}</button>
            <button disabled={character.status === 'archived'} type="button"
              onClick={() => void onUpdate({ character_id: character.id,
                status: 'archived' })}>归档</button></footer>
        </article>)}
      </div>
      </> : null}
    </aside>
  );
}
