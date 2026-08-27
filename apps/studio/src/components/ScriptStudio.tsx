import { useEffect, useMemo, useState } from 'react';
import type {
  ScriptSceneInput,
  ScriptSourceFormat,
} from '@h3storyboard/protocol';
import { useScriptStudio } from '../lib/use-script-studio.js';
import { ScriptSceneEditor } from './ScriptSceneEditor.js';
import { PlanReviewPanel } from './PlanReviewPanel.js';

interface ScriptStudioProps {
  projectId: string;
  onOpenCanvas: () => void;
  onProjectChanged: () => Promise<void>;
}

type ScriptWorkflowStage = 'import' | 'edit' | 'compile' | 'review' | 'complete'
  | 'archived';

export function ScriptStudio({ projectId, onOpenCanvas,
  onProjectChanged }: ScriptStudioProps) {
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
  const archived = studio.document?.version.status === 'superseded';
  const reviewActive = Boolean(studio.review &&
    studio.review.active_compilation_id === studio.review.compilation.id);
  const reviewArchived = Boolean(archived && studio.review && !reviewActive);
  const showImport = importing || (!archived && !structured && !hasDraft);
  const workflowStage: ScriptWorkflowStage = archived && !reviewActive ? 'archived'
    : showImport ? 'import'
    : editable ? 'edit' : !studio.review ? 'compile'
      : studio.review.compilation.status === 'draft' ? 'review' : 'complete';

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
    await onProjectChanged();
  };
  const approve = async () => {
    if (!await studio.approveReview()) return;
    await onProjectChanged();
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
      <ScriptProgressGuide stage={workflowStage}
        archived={reviewArchived || studio.review?.compilation.status === 'superseded'}
        archivedCompletedSteps={!studio.review ? 2
          : studio.review.compilation.status === 'draft' ? 3 : 4} />
      {showImport ? <section className="script-import-panel">
        <header className="script-import-intro">
          <span className="eyebrow">STEP 01 · IMPORT</span>
          <h1>从剧本开始，画布会自动生成</h1>
          <p>先粘贴完整剧本。系统会拆成 Scene 和 Beat，经过校验、锁定与导演审核后，再自动建立画布。</p>
          <div className="script-import-hint"><strong>普通文本格式</strong>
            <code>SC-01 雨巷 夜<br />苏晚宁：今晚别走。<br />顾承渊收起伞。</code></div>
        </header>
        <div className="script-import-form">
          <div className="script-import-meta">
            <label>新版本标题<input value={importTitle}
              onChange={(event) => setImportTitle(event.target.value)} /></label>
            <label>导入格式<select value={importFormat}
              onChange={(event) => setImportFormat(
                event.target.value as typeof importFormat)}>
              <option value="plain_text">普通剧本文本</option>
              <option value="shuohao_novel_script">shuohao novel-script JSON</option>
            </select></label>
          </div>
          <label>剧本内容<textarea aria-label="剧本内容" rows={12}
            placeholder="粘贴包含场景、动作和对白的完整剧本…"
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
        {archived ? <section className="script-archive-notice" role="status">
          <strong>{reviewActive ? '剧本已有接替版本' : '这是历史剧本版本'}</strong>
          <p>{reviewActive
            ? '此版本的分镜仍是当前执行计划；新分镜批准前，生产继续使用这一套。'
            : '该版本已归档，仅供查看。请选择当前版本，或导入一个新版本继续制作。'}</p>
        </section> : null}
        {studio.review ? <PlanReviewPanel archived={reviewArchived} busy={studio.busy}
          review={studio.review} onOpenCanvas={onOpenCanvas}
          onUpdate={studio.updateReviewShot} onApprove={approve} /> :
        <div className="script-scenes">
          {scenes.map((scene, index) => <ScriptSceneEditor key={scene.id}
            scene={scene} disabled={!editable}
            onChange={(next) => updateScene(index, next)}
            onRemove={() => removeScene(index)} />)}
          {editable ? <button className="script-add-scene" onClick={addScene}
            type="button">＋ 新增场景</button> : null}
        </div>}
      </>}
      {studio.message ? <div className="script-message" role="status">
        {studio.message}</div> : null}
    </section>
  </main>;
}

function renumberScenes(scenes: ScriptSceneInput[]): ScriptSceneInput[] {
  return scenes.map((scene, index) => ({ ...scene, ordinal: index + 1 }));
}

function ScriptProgressGuide({ stage, archived, archivedCompletedSteps }: {
  stage: ScriptWorkflowStage;
  archived: boolean;
  archivedCompletedSteps: number;
}) {
  const stages: Array<[ScriptWorkflowStage, string]> = [
    ['import', '导入剧本'], ['edit', '编辑与校验'], ['compile', '锁定并编译'],
    ['review', '审核并批准'], ['complete', archived ? '历史已归档' : '进入画布'],
  ];
  const activeIndex = stages.findIndex(([key]) => key === stage);
  return <nav className="script-progress" aria-label="剧本制作进度">
    <ol>{stages.map(([key, label], index) => <li key={key}
      data-state={stage === 'archived'
        ? index < archivedCompletedSteps ? 'done'
          : index === 4 ? 'current' : 'skipped'
        : index < activeIndex ? 'done'
          : index === activeIndex ? 'current' : 'next'}>
      <span>{String(index + 1).padStart(2, '0')}</span><strong>{label}</strong>
    </li>)}</ol>
  </nav>;
}
