import { useEffect, useMemo, useState } from 'react';
import type {
  ScriptSceneInput,
  ScriptSourceFormat,
} from '@h3storyboard/protocol';
import { useScriptStudio } from '../lib/use-script-studio.js';
import { ScriptSceneEditor } from './ScriptSceneEditor.js';

interface ScriptStudioProps {
  projectId: string;
  onCompiled: () => Promise<void>;
}

export function ScriptStudio({ projectId, onCompiled }: ScriptStudioProps) {
  const studio = useScriptStudio(projectId);
  const [importTitle, setImportTitle] = useState('新剧本版本');
  const [importFormat, setImportFormat] = useState<Exclude<ScriptSourceFormat,
    'legacy_text'>>('plain_text');
  const [importContent, setImportContent] = useState('');
  const [importing, setImporting] = useState(false);
  const [title, setTitle] = useState('');
  const [scenes, setScenes] = useState<ScriptSceneInput[]>([]);
  const editable = studio.document?.version.status === 'draft';
  const structured = Boolean(studio.document &&
    (studio.document.scenes.length > 0 ||
      studio.document.version.source_format !== 'legacy_text'));
  const hasDraft = studio.versions.some(({ status }) => status === 'draft');
  const showImport = importing || (!structured && !hasDraft);

  useEffect(() => {
    if (!studio.document) return;
    setTitle(studio.document.version.title);
    setScenes(studio.document.scenes);
  }, [studio.document]);
  useEffect(() => { setImporting(false); }, [projectId]);

  const duration = useMemo(() => scenes.reduce((sum, scene) =>
    sum + scene.beats.reduce((beatSum, beat) =>
      beatSum + beat.duration_seconds, 0), 0), [scenes]);
  const input = () => ({ expected_revision: studio.document?.version.revision ?? 0,
    title, scenes });
  const save = () => studio.save(input());
  const validate = async () => {
    if (editable && !await save()) return;
    await studio.validate();
  };
  const lock = async () => {
    const saved = editable ? await save() : studio.document;
    if (!saved) return;
    const validation = await studio.validate();
    if (!validation?.valid) return;
    await studio.lock(saved.version.revision);
  };
  const compile = async () => {
    if (!await studio.compile()) return;
    await onCompiled();
  };
  const updateScene = (index: number, scene: ScriptSceneInput) => setScenes(
    scenes.map((item, sceneIndex) => sceneIndex === index ? scene : item));
  const removeScene = (index: number) => setScenes(renumberScenes(
    scenes.filter((_, sceneIndex) => sceneIndex !== index)));
  const addScene = () => setScenes([...scenes, {
    id: crypto.randomUUID(), ordinal: scenes.length + 1,
    scene_key: `SC-${String(scenes.length + 1).padStart(2, '0')}`,
    heading: '新场景', location: '', time_of_day: '', lighting: '', summary: '',
    beats: [{ id: crypto.randomUUID(), ordinal: 1, kind: 'action',
      text: '新的动作。', duration_seconds: 3, character_refs: [],
      costume_state: {}, position_state: {}, prop_state: {} }],
  }]);

  return <main className="script-studio" aria-label="剧本工作台">
    <aside className="script-version-rail">
      <span className="eyebrow">SCRIPT VERSIONS</span>
      <h2>版本链</h2>
      {studio.versions.map((version) => <button key={version.id} type="button"
        disabled={studio.busy} onClick={() => void studio.selectVersion(version.id)}
        data-active={version.id === studio.document?.version.id}>
        <strong>V{version.version} · {version.title}</strong>
        <span data-status={version.status}>{version.status}</span>
        <small>{version.source_format}</small>
      </button>)}
      {!hasDraft ? <button className="button compact" type="button"
        onClick={() => setImporting(true)}>＋ 导入新版本</button> : null}
    </aside>
    <section className="script-editor-shell">
      {showImport ? <section className="script-import-panel">
        <span className="eyebrow">P2.1 / IMPORT</span>
        <h1>建立可编译的结构化剧本</h1>
        <p>粘贴普通剧本，或导入 shuohao novel-script JSON。导入只创建草稿，不改写当前锁定版本。</p>
        <label>新版本标题<input value={importTitle}
          onChange={(event) => setImportTitle(event.target.value)} /></label>
        <label>导入格式<select value={importFormat}
          onChange={(event) => setImportFormat(event.target.value as typeof importFormat)}>
          <option value="plain_text">普通剧本文本</option>
          <option value="shuohao_novel_script">shuohao novel-script JSON</option>
        </select></label>
        <label>剧本内容<textarea aria-label="剧本内容" rows={18}
          value={importContent} onChange={(event) =>
            setImportContent(event.target.value)} /></label>
        <div className="script-actions">
          <button className="button button-primary" disabled={studio.busy ||
            importContent.trim().length === 0} onClick={() => void (async () => {
              const result = await studio.importDraft({ format: importFormat,
                title: importTitle, content: importContent });
              if (result) setImporting(false);
            })()} type="button">导入为草稿</button>
          {structured ? <button className="button" onClick={() =>
            setImporting(false)} type="button">取消</button> : null}
        </div>
      </section> : <>
        <header className="script-editor-header">
          <div><span className="eyebrow">STRUCTURED SCRIPT</span>
            <input aria-label="剧本版本标题" disabled={!editable} value={title}
              onChange={(event) => setTitle(event.target.value)} />
            <p>{scenes.length} 场 · {scenes.reduce((sum, scene) =>
              sum + scene.beats.length, 0)} Beats · {duration.toFixed(1)} 秒</p></div>
          <div className="script-actions">
            {editable ? <button className="button" disabled={studio.busy}
              onClick={() => void save()} type="button">保存草稿</button> : null}
            <button className="button" disabled={studio.busy}
              onClick={() => void validate()} type="button">运行校验</button>
            {editable ? <button className="button button-primary"
              disabled={studio.busy} onClick={() => void lock()}
              type="button">锁定剧本</button> : null}
            {studio.document?.version.status === 'locked' ? <button
              className="button button-primary" disabled={studio.busy}
              onClick={() => void compile()} type="button">编译草稿分镜</button> : null}
          </div>
        </header>
        {studio.validation ? <section className="script-validation"
          data-valid={studio.validation.valid} aria-label="剧本校验结果">
          <strong>{studio.validation.valid ? '校验通过' : '校验未通过'}</strong>
          {studio.validation.issues.map((issue, index) => <p key={`${issue.code}-${index}`}
            data-severity={issue.severity}>{issue.code} · {issue.message}</p>)}
        </section> : null}
        <div className="script-scenes">
          {scenes.map((scene, index) => <ScriptSceneEditor key={scene.id}
            scene={scene} disabled={!editable}
            onChange={(next) => updateScene(index, next)}
            onRemove={() => removeScene(index)} />)}
          {editable ? <button className="script-add-scene" onClick={addScene}
            type="button">＋ 新增场景</button> : null}
        </div>
      </>}
      {studio.message ? <div className="script-message" role="status">
        {studio.message}</div> : null}
    </section>
  </main>;
}

function renumberScenes(scenes: ScriptSceneInput[]): ScriptSceneInput[] {
  return scenes.map((scene, index) => ({ ...scene, ordinal: index + 1 }));
}
