import { useState, type FormEvent } from 'react';
import { useProduction } from '../lib/use-production.js';

export function ProductionBriefPanel({ projectId, onClose }:
  { projectId: string; onClose: () => void }) {
  const store = useProduction(projectId);
  const latest = store.briefs.at(-1);
  const [editing, setEditing] = useState(false);
  const [modeKey, setModeKey] = useState('');
  const [logline, setLogline] = useState('');
  const [styleNotes, setStyleNotes] = useState('');
  const [textStyleLock, setTextStyleLock] = useState('');
  const [hardRules, setHardRules] = useState('');
  const [reason, setReason] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await store.createBrief({ mode_key: modeKey,
      body: { logline, style_notes: styleNotes,
        text_style_lock: textStyleLock.trim() || null,
        hard_rules: hardRules.split('\n').map((rule) => rule.trim()).filter(Boolean) } });
    if (saved) setEditing(false);
  };

  return <aside className="production-panel" aria-label="Production Brief and Lock">
    <header><div><span className="eyebrow">PRODUCTION CONTEXT</span>
      <strong>Brief V{latest?.brief_version ?? '—'}</strong></div>
      <button type="button" onClick={onClose}>关闭</button></header>
    <section className="generation-lock" data-engaged={store.lock?.engaged ?? false}>
      <header><div><strong>{store.lock?.engaged ? 'GENERATION LOCKED' : 'GENERATION OPEN'}</strong>
        <small>{store.lock?.reason ?? '冻结后才能创建 H3 Job'}</small></div>
        {store.lock?.engaged ? <button disabled={store.busy} type="button"
          onClick={() => void store.updateLock({ engaged: false })}>RELEASE</button>
          : <button disabled={store.busy || !latest || !reason.trim()} type="button"
            onClick={() => void store.updateLock({ engaged: true, reason: reason.trim() })}>
            ENGAGE</button>}</header>
      {!store.lock?.engaged ? <input value={reason}
        disabled={!latest} onChange={(event) => setReason(event.target.value)}
        placeholder={latest ? 'Lock reason…' : '请先建立 Production Brief'} /> : null}
    </section>
    {store.error ? <p className="production-error" role="alert">{store.error}</p> : null}
    <section className="brief-current"><header><div><span className="eyebrow">INTENT SSOT</span>
      <strong>{latest?.body.logline ?? '尚未建立 Production Brief'}</strong></div>
      <button disabled={store.lock?.engaged} type="button"
        onClick={() => { setEditing((value) => !value);
          setModeKey(latest?.mode_key ?? store.modes[0]?.key ?? ''); }}>＋ 新版本</button></header>
      {latest ? <><p>{latest.body.style_notes}</p>
        <small>MODE · {latest.mode_key} · {latest.body.hard_rules.length} HARD RULES</small>
        {latest.body.text_style_lock ? <blockquote>{latest.body.text_style_lock}</blockquote> : null}
      </> : null}</section>
    {editing ? <form className="brief-form" onSubmit={submit}>
      <label><span>MODE</span><select required value={modeKey}
        onChange={(event) => setModeKey(event.target.value)}>
        <option value="" disabled>选择 Mode</option>{store.modes.map((mode) =>
          <option key={mode.id} value={mode.key}>{mode.title} · {mode.validation_status}</option>)}</select></label>
      <label><span>LOGLINE</span><textarea required value={logline}
        onChange={(event) => setLogline(event.target.value)} /></label>
      <label><span>STYLE NOTES</span><textarea required value={styleNotes}
        onChange={(event) => setStyleNotes(event.target.value)} /></label>
      <label><span>TEXT STYLE LOCK</span><textarea value={textStyleLock}
        onChange={(event) => setTextStyleLock(event.target.value)} /></label>
      <label><span>HARD RULES · 每行一条</span><textarea required value={hardRules}
        onChange={(event) => setHardRules(event.target.value)} /></label>
      <button className="button-primary" disabled={store.busy} type="submit">追加 BRIEF V{
        (latest?.brief_version ?? 0) + 1}</button>
    </form> : null}
  </aside>;
}
