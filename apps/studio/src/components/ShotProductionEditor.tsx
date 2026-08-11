import { useEffect, useState, type FormEvent } from 'react';
import type { SemanticReference, ShotPlan, ShotState,
  UpdateShotPlanInput } from '@h3storyboard/protocol';
import * as api from '../lib/api.js';

interface Props {
  projectId: string;
  shot: ShotPlan;
  busy: boolean;
  onClose: () => void;
  onSave: (input: UpdateShotPlanInput) => Promise<boolean>;
}

const purposes: SemanticReference['purpose'][] = [
  'first_frame', 'last_frame', 'reference_character', 'reference_prop',
  'reference_composition', 'reference_style', 'reference_stage',
  'reference_target_state',
];

function targetValue(reference: SemanticReference): string {
  return reference.target.type === 'asset'
    ? `asset:${reference.target.asset_id}`
    : `character:${reference.target.character_id}`;
}

function stateText(state: ShotState | null): string {
  return state ? JSON.stringify(state, null, 2) : '';
}

export function ShotProductionEditor({ projectId, shot, busy, onClose,
  onSave }: Props) {
  const [references, setReferences] = useState(shot.semantic_references);
  const [opening, setOpening] = useState(stateText(shot.opening_state));
  const [ending, setEnding] = useState(stateText(shot.ending_state));
  const [targets, setTargets] = useState<Array<{ value: string; label: string }>>([]);
  const [result, setResult] = useState('');

  useEffect(() => { void Promise.all([api.listAssets(projectId),
    api.listCharacters(projectId)]).then(([assets, characters]) => setTargets([
      ...assets.filter(({ status, kind }) => status === 'approved' && kind === 'image')
        .map((asset) => ({ value: `asset:${asset.id}`,
          label: `资产 · ${asset.uri}` })),
      ...characters.filter(({ status }) => status !== 'archived')
        .map((character) => ({ value: `character:${character.id}`,
          label: `角色 · ${character.name}` })),
    ])).catch((error: Error) => setResult(error.message)); }, [projectId]);

  function updateReference(index: number, purpose: SemanticReference['purpose'],
    target = targetValue(references[index]!)) {
    const [type, id] = target.split(':') as ['asset' | 'character', string];
    setReferences((current) => current.map((reference, position) => position === index
      ? { purpose, target: type === 'asset' ? { type, asset_id: id } :
        { type, character_id: id } } : reference));
  }

  function addReference() {
    const target = targets[0]?.value;
    if (!target) return;
    const [type, id] = target.split(':') as ['asset' | 'character', string];
    setReferences((current) => [...current, { purpose: 'first_frame',
      target: type === 'asset' ? { type, asset_id: id } :
        { type, character_id: id } }]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const saved = await onSave({ shot_plan_id: shot.id,
        semantic_references: references,
        opening_state: opening.trim() ? JSON.parse(opening) as ShotState : null,
        ending_state: ending.trim() ? JSON.parse(ending) as ShotState : null });
      if (!saved) return;
      const compiled = await api.compileShotBindings(shot.id);
      setResult(`${compiled.generation_mode} · ${compiled.bindings.length} 个有序输入`);
    } catch (error) {
      setResult(error instanceof Error ? error.message : '状态 JSON 无效');
    }
  }

  return <div className="modal-backdrop align-right" role="presentation"
    onMouseDown={onClose}><section className="composer-card shot-composer" role="dialog"
      aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
      <header className="composer-header"><div><span className="eyebrow">SHOT INPUTS</span>
        <h2>{shot.title}</h2></div><button className="icon-button" type="button"
          onClick={onClose}>×</button></header>
      <form className="composer-form" onSubmit={submit}>
        <div className="intake-note"><span>COMPILE</span><div><strong>全部且仅有</strong>
          <p>语义引用只会解析当前 manifest 内的 approved 资产。</p></div></div>
        {references.map((reference, index) => <div className="binding-editor-row"
          key={`${index}-${reference.purpose}`}><label><span>用途</span><select
            value={reference.purpose} onChange={(event) => updateReference(index,
              event.target.value as SemanticReference['purpose'])}>
            {purposes.map((purpose) => <option key={purpose}>{purpose}</option>)}</select>
          </label><label><span>目标</span><select value={targetValue(reference)}
            onChange={(event) => updateReference(index, reference.purpose,
              event.target.value)}>{targets.map((target) => <option key={target.value}
                value={target.value}>{target.label}</option>)}</select></label>
          <button className="icon-button" type="button" onClick={() =>
            setReferences((current) => current.filter((_, at) => at !== index))}>−</button>
        </div>)}
        <button className="button button-ghost compact" disabled={!targets.length}
          type="button" onClick={addReference}>＋ 语义引用</button>
        <label><span>OPENING STATE / JSON</span><textarea value={opening}
          onChange={(event) => setOpening(event.target.value)} /></label>
        <label><span>ENDING STATE / JSON</span><textarea value={ending}
          onChange={(event) => setEnding(event.target.value)} /></label>
        {result ? <p className="rail-empty" aria-live="polite">{result}</p> : null}
        <footer className="composer-footer"><span>保存后立即 dry-run 编译</span><div>
          <button className="button button-ghost" type="button" onClick={onClose}>取消</button>
          <button className="button button-primary" disabled={busy} type="submit">保存并编译</button>
        </div></footer>
      </form>
    </section></div>;
}
