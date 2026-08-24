import { useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import type {
  Asset,
  Character,
  CharacterImageJob,
  CharacterImageOperation,
  CharacterReference,
  CreateCharacterImageJobInput,
} from '@h3storyboard/protocol';
import {
  buildCharacterImageJobInput,
  CHARACTER_IMAGE_OPERATION_LABELS,
  characterImageDefaults,
  type CharacterImageFormValues,
} from '../lib/character-image-form.js';

interface CharacterImageGenerationPanelProps {
  character: Character;
  references: CharacterReference[];
  assetById: Map<string, Asset>;
  busy: boolean;
  onClose: () => void;
  onCreate: (input: CreateCharacterImageJobInput) =>
    Promise<CharacterImageJob | null>;
}

export function CharacterImageGenerationPanel({ character, references,
  assetById, busy, onClose, onCreate }: CharacterImageGenerationPanelProps) {
  const approved = useMemo(() => references.filter((reference) => {
    const asset = reference.asset_id ? assetById.get(reference.asset_id) : null;
    return asset?.kind === 'image' && asset.status === 'approved';
  }).sort((left, right) => left.sort_order - right.sort_order),
  [assetById, references]);
  const approvedRoot = approved.find(({ derived_from }) => derived_from === null);
  const initialOperation: CharacterImageOperation = approvedRoot
    ? 'identity_edit' : 'master_t2i';
  const [values, setValues] = useState<CharacterImageFormValues>(() =>
    initialValues(initialOperation, character, approvedRoot?.id ?? null));
  const [formError, setFormError] = useState<string | null>(null);

  const changeOperation = (operation: CharacterImageOperation) => {
    setValues(initialValues(operation, character, approvedRoot?.id ?? null));
    setFormError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const sourceCount = values.source_reference_ids.length;
    if (values.operation === 'identity_edit' && (sourceCount < 1 || sourceCount > 3)) {
      setFormError('Qwen 身份编辑必须选择 1–3 张 approved 参考图。');
      return;
    }
    if (values.operation === 'variant_i2i' && sourceCount !== 1) {
      setFormError('Krea 轻派生必须选择一张 approved 母图。');
      return;
    }
    if (await onCreate(buildCharacterImageJobInput(values))) onClose();
  };

  return createPortal(<div className="modal-backdrop align-right" role="presentation"
    onMouseDown={onClose}>
    <section aria-label={`${character.name} 角色图生成`} aria-modal="true"
      className="composer-card character-image-composer" role="dialog"
      onMouseDown={(event) => event.stopPropagation()}>
      <header className="composer-header"><div><span className="eyebrow">
        LOCAL COMFYUI · CANDIDATE ONLY</span><h2>{character.name} · 角色图生成</h2></div>
        <button aria-label="关闭角色图生成" className="icon-button"
          onClick={onClose} type="button">×</button></header>
      <form className="composer-form character-image-form" onSubmit={submit}>
        <label><span>生成方式</span><select aria-label="生成方式"
          value={values.operation} onChange={(event) => changeOperation(
            event.target.value as CharacterImageOperation)}>
          {(Object.entries(CHARACTER_IMAGE_OPERATION_LABELS) as Array<
            [CharacterImageOperation, string]>).map(([operation, label]) =>
            <option key={operation} value={operation}
              disabled={operation !== 'master_t2i' && approved.length === 0}>
              {label}</option>)}</select></label>
        <div className="character-image-engine-strip">
          <span>ENGINE <b>{values.operation === 'identity_edit'
            ? 'QWEN IMAGE EDIT 2511' : 'KREA2'}</b></span>
          <span>OUTPUT <b>CANDIDATE</b></span><span>LORA <b>无（不会默认加载）</b></span>
        </div>
        <label><span>提示词</span><textarea autoFocus required maxLength={7_000}
          value={values.prompt} onChange={(event) => setValues(
            (current) => ({ ...current, prompt: event.target.value }))} /></label>
        <div className="field-grid three-columns">
          <NumberField label="Seed" min={0} value={values.seed}
            onChange={(seed) => setValues((current) => ({ ...current, seed }))} />
          <NumberField label="宽" min={64} max={4096} step={8} value={values.width}
            onChange={(width) => setValues((current) => ({ ...current, width }))} />
          <NumberField label="高" min={64} max={4096} step={8} value={values.height}
            onChange={(height) => setValues((current) => ({ ...current, height }))} />
        </div>
        <div className="field-grid three-columns">
          <NumberField label="Steps" min={1} max={100} value={values.steps}
            onChange={(steps) => setValues((current) => ({ ...current, steps }))} />
          <NumberField label="CFG" min={0.1} max={30} step={0.1} value={values.cfg}
            onChange={(cfg) => setValues((current) => ({ ...current, cfg }))} />
          {values.operation !== 'master_t2i' ? <NumberField label="Denoise"
            min={0} max={1} step={0.01} value={values.denoise ?? 1}
            onChange={(denoise) => setValues(
              (current) => ({ ...current, denoise }))} /> : <div />}
        </div>
        <div className="field-grid two-columns">
          <label><span>Sampler</span><input required value={values.sampler}
            onChange={(event) => setValues(
              (current) => ({ ...current, sampler: event.target.value }))} /></label>
          <label><span>Scheduler</span><input required value={values.scheduler}
            onChange={(event) => setValues(
              (current) => ({ ...current, scheduler: event.target.value }))} /></label>
        </div>
        {values.operation === 'identity_edit' ? <fieldset
          className="character-image-sources"><legend>Approved 身份参考（1–3 张）</legend>
          {approved.map((reference) => <label key={reference.id}><input
            type="checkbox" checked={values.source_reference_ids.includes(reference.id)}
            disabled={!values.source_reference_ids.includes(reference.id) &&
              values.source_reference_ids.length >= 3}
            onChange={() => setValues((current) => ({ ...current,
              source_reference_ids: toggleSource(
                current.source_reference_ids, reference.id),
            }))} />{sourceLabel(reference, assetById)}</label>)}</fieldset> : null}
        {values.operation === 'variant_i2i' ? <label><span>Approved 母图</span>
          <select aria-label="Approved 母图" required
            value={values.source_reference_ids[0] ?? ''}
            onChange={(event) => setValues((current) => ({ ...current,
              source_reference_ids: event.target.value ? [event.target.value] : [],
            }))}><option value="">请选择</option>
            {approved.filter(({ derived_from }) => derived_from === null)
              .map((reference) => <option key={reference.id} value={reference.id}>
                {sourceLabel(reference, assetById)}</option>)}</select></label> : null}
        {formError ? <p className="production-board-error" role="alert">
          {formError}</p> : null}
        <p className="character-image-candidate-note">生成完成只注册 candidate；
          不会自动批准，也不会自动改写 CURRENT-ASSETS。</p>
        <footer className="composer-footer"><span>4090 · LOCAL COMFYUI</span><div>
          <button className="button button-ghost" onClick={onClose}
            type="button">取消</button><button className="button button-primary"
              disabled={busy} type="submit">{busy ? '提交中…' : '提交角色图任务'}</button>
        </div></footer>
      </form>
    </section>
  </div>, document.body);
}

function initialValues(operation: CharacterImageOperation, character: Character,
  rootReferenceId: string | null): CharacterImageFormValues {
  const defaults = characterImageDefaults(operation);
  return { operation, prompt: character.canonical_appearance,
    seed: character.seed_family[0] ?? 1, width: 480, height: 864,
    steps: defaults.steps, cfg: defaults.cfg, sampler: defaults.sampler,
    scheduler: defaults.scheduler, denoise: defaults.denoise,
    source_reference_ids: operation === 'master_t2i' || !rootReferenceId
      ? [] : [rootReferenceId] };
}

function toggleSource(current: string[], referenceId: string) {
  return current.includes(referenceId)
    ? current.filter((id) => id !== referenceId) : [...current, referenceId];
}

function sourceLabel(reference: CharacterReference, assetById: Map<string, Asset>) {
  return reference.asset_id ? assetById.get(reference.asset_id)?.name ?? reference.id
    : reference.id;
}

function NumberField({ label, value, onChange, ...limits }: {
  label: string; value: number; onChange: (value: number) => void;
  min: number; max?: number; step?: number;
}) {
  return <label><span>{label}</span><input required type="number" value={value}
    {...limits} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
