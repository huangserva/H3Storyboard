import { useState, type FormEvent } from 'react';
import type {
  ModeCapabilityDeclaration,
  ModeValidationStatus,
} from '@h3storyboard/protocol';
import { useModes } from '../lib/use-modes.js';

const DEFAULT_CAPABILITY = JSON.stringify({
  generation_modes: ['i2v', 'fl2v'],
  duration_seconds: { min: 2, max: 15 },
  resolution: { min_width: 480, max_width: 480,
    min_height: 864, max_height: 864 },
  lora_profile_requirements: [],
  provider_requirements: ['local_comfyui'],
  extensions: {},
}, null, 2);

export function ModeRegistryPanel({ onClose }: { onClose: () => void }) {
  const store = useModes();
  const [creating, setCreating] = useState(false);
  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [capability, setCapability] = useState(DEFAULT_CAPABILITY);
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    let declaration: ModeCapabilityDeclaration;
    try { declaration = JSON.parse(capability) as ModeCapabilityDeclaration; } catch {
      setLocalError('Capability declaration 必须是有效 JSON'); return;
    }
    if (await store.create({ key, title, description,
      capability_declaration: declaration })) {
      setCreating(false); setKey(''); setTitle(''); setDescription('');
      setCapability(DEFAULT_CAPABILITY); setLocalError(null);
    }
  };

  const transition = async (modeId: string, status: ModeValidationStatus) => {
    const needsEvidence = status === 'validated' || status === 'blocked';
    const note = evidence[modeId]?.trim() ?? '';
    if (needsEvidence && !note) {
      setLocalError('Promote / block 必须填写 evidence'); return;
    }
    if (await store.update({ mode_id: modeId, validation_status: status,
      ...(needsEvidence ? { evidence: note } : {}) })) {
      setEvidence((current) => ({ ...current, [modeId]: '' }));
      setLocalError(null);
    }
  };

  return <aside className="mode-registry" aria-label="Production Mode Registry">
    <header><div><span className="eyebrow">PRODUCTION POLICY</span>
      <strong>Mode Registry</strong></div><div>
      <button type="button" onClick={() => setCreating((value) => !value)}>＋ 新建</button>
      <button type="button" onClick={onClose}>关闭</button></div></header>
    {creating ? <form className="mode-form" onSubmit={submit}>
      <label><span>KEY</span><input required value={key}
        onChange={(event) => setKey(event.target.value)} placeholder="cinematic-drama" /></label>
      <label><span>TITLE</span><input required value={title}
        onChange={(event) => setTitle(event.target.value)} /></label>
      <label><span>DESCRIPTION</span><textarea required value={description}
        onChange={(event) => setDescription(event.target.value)} /></label>
      <label><span>CAPABILITY JSON</span><textarea className="mode-capability"
        required value={capability} onChange={(event) => setCapability(event.target.value)} /></label>
      <button className="button-primary" disabled={store.busy} type="submit">保存 Candidate</button>
    </form> : null}
    {localError || store.error ? <p className="mode-error" role="alert">
      {localError ?? store.error}</p> : null}
    <div className="mode-list">{store.modes.map((mode) => <article key={mode.id}
      data-status={mode.validation_status}>
      <header><div><strong>{mode.title}</strong><small>{mode.key}</small></div>
        <span>{mode.validation_status}</span></header>
      <p>{mode.description}</p>
      <small>{mode.capability_declaration.generation_modes.join(' + ')} · {
        mode.capability_declaration.duration_seconds.min}–{
        mode.capability_declaration.duration_seconds.max}s</small>
      {mode.validation_status !== 'blocked' ? <input aria-label={`${mode.key} evidence`}
        value={evidence[mode.id] ?? ''} onChange={(event) => setEvidence((current) =>
          ({ ...current, [mode.id]: event.target.value }))} placeholder="Validation evidence…" /> : null}
      <footer>{mode.validation_status === 'candidate' ? <button type="button"
        disabled={store.busy} onClick={() => void transition(mode.id, 'validated')}>
          PROMOTE</button> : null}
        {mode.validation_status === 'validated' ? <button type="button"
          disabled={store.busy} onClick={() => void transition(mode.id, 'blocked')}>
          BLOCK</button> : null}
        {mode.validation_status === 'blocked' ? <button type="button"
          disabled={store.busy} onClick={() => void transition(mode.id, 'candidate')}>
          REOPEN</button> : null}</footer>
    </article>)}</div>
  </aside>;
}
