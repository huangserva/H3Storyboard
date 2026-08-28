import { useState } from 'react';
import type {
  GenerateScriptInput,
  ImportScriptInput,
  ScriptGenerationCapability,
  ScriptSourceFormat,
} from '@h3storyboard/protocol';

interface ScriptEntryPanelProps {
  busy: boolean;
  capability: ScriptGenerationCapability | null;
  canCancel: boolean;
  onCancel: () => void;
  onGenerate: (input: GenerateScriptInput) => Promise<unknown>;
  onImport: (input: ImportScriptInput) => Promise<unknown>;
}

type EntryMode = 'generate' | 'import';

export function ScriptEntryPanel({ busy, capability, canCancel, onCancel,
  onGenerate, onImport }: ScriptEntryPanelProps) {
  const [mode, setMode] = useState<EntryMode>('generate');
  return <section className="script-entry-panel" aria-label="新建剧本草稿">
    <header className="script-entry-intro">
      <span className="eyebrow">STEP 01 · CREATE</span>
      <h1>{mode === 'generate' ? '让 AI 先写出可编辑剧本' : '导入你已有的剧本'}</h1>
      <p>{mode === 'generate'
        ? '从创意、小说片段或梗概开始。AI 会按 shuohao 的 Scene / Beat 结构写作并通过质量门，结果只保存为草稿。'
        : '粘贴普通剧本文本或 shuohao JSON，系统会拆成 Scene 和 Beat，进入同一套校验与审核流程。'}</p>
      <div className="script-entry-safety">
        <strong>不会自动出片</strong>
        <span>生成后仍需人工编辑、校验、锁定和批准；不会提交 4090，也不会生成 TTS 或外部声音。</span>
      </div>
    </header>
    <div className="script-entry-card">
      <div className="script-entry-tabs" role="tablist" aria-label="剧本创建方式">
        <button type="button" role="tab" aria-selected={mode === 'generate'}
          onClick={() => setMode('generate')}>AI 生成剧本</button>
        <button type="button" role="tab" aria-selected={mode === 'import'}
          onClick={() => setMode('import')}>导入已有剧本</button>
      </div>
      {mode === 'generate'
        ? <GenerateScriptForm busy={busy} capability={capability}
          onGenerate={onGenerate} />
        : <ImportScriptForm busy={busy} onImport={onImport} />}
      {canCancel ? <button className="button script-entry-cancel" type="button"
        onClick={onCancel}>取消新建</button> : null}
    </div>
  </section>;
}

function GenerateScriptForm({ busy, capability, onGenerate }: {
  busy: boolean;
  capability: ScriptGenerationCapability | null;
  onGenerate: (input: GenerateScriptInput) => Promise<unknown>;
}) {
  const [title, setTitle] = useState('AI 剧本草稿');
  const [premise, setPremise] = useState('');
  const [genre, setGenre] = useState('剧情片');
  const [duration, setDuration] = useState(120);
  const [sceneCount, setSceneCount] = useState(4);
  const [characters, setCharacters] = useState('');
  const [tone, setTone] = useState('电影感，自然、清楚的中文对白');
  const [constraints, setConstraints] = useState('');
  const available = capability?.available === true;
  return <form className="script-entry-form" onSubmit={(event) => {
    event.preventDefault();
    if (!available) return;
    void onGenerate({
      title,
      premise,
      genre,
      target_duration_seconds: duration,
      target_scene_count: sceneCount,
      characters: characters.split(/\r?\n/).map((item) => item.trim())
        .filter(Boolean),
      tone,
      constraints,
    });
  }}>
    <GenerationStatus capability={capability} />
    <label className="script-entry-wide">故事创意或原文
      <textarea aria-label="故事创意或原文" rows={7}
        placeholder="例如：一对旧情人在上海雨夜重逢。她决定结束长期逃避，而他必须在天亮前作出选择……"
        value={premise} onChange={(event) => setPremise(event.target.value)} />
    </label>
    <label>版本标题<input aria-label="AI 剧本标题" value={title}
      onChange={(event) => setTitle(event.target.value)} /></label>
    <label>题材<input aria-label="剧本题材" value={genre}
      onChange={(event) => setGenre(event.target.value)} /></label>
    <label>目标时长（秒）<input aria-label="目标时长（秒）" type="number"
      min={15} max={7200} value={duration}
      onChange={(event) => setDuration(Number(event.target.value))} /></label>
    <label>目标场景数<input aria-label="目标场景数" type="number"
      min={1} max={60} value={sceneCount}
      onChange={(event) => setSceneCount(Number(event.target.value))} /></label>
    <label className="script-entry-wide">主要人物（每行一个，可写性格约束）
      <textarea aria-label="主要人物" rows={3}
        placeholder={'苏晚宁：克制，但在关键时刻主动\n顾承渊：寡言，习惯回避'}
        value={characters} onChange={(event) => setCharacters(event.target.value)} />
    </label>
    <label>风格与语气<input aria-label="风格与语气" value={tone}
      onChange={(event) => setTone(event.target.value)} /></label>
    <label>额外限制<input aria-label="额外限制" value={constraints}
      placeholder="必须保留的情节、禁止出现的内容……"
      onChange={(event) => setConstraints(event.target.value)} /></label>
    <div className="script-entry-submit script-entry-wide">
      <p>AI 会先写完整结构化草稿；若首轮不通过格式、时长或对白质量门，会自动修复一次。</p>
      <button className="button button-primary" type="submit"
        disabled={busy || !available || premise.trim().length < 10 ||
          title.trim().length === 0 || genre.trim().length === 0}>
        {busy ? '正在生成…' : '生成 AI 草稿'}
      </button>
    </div>
  </form>;
}

function GenerationStatus({ capability }: {
  capability: ScriptGenerationCapability | null;
}) {
  if (!capability) return <div className="script-generation-status"
    data-available="false">正在检查 AI 模型配置…</div>;
  return <div className="script-generation-status"
    data-available={capability.available}>
    <strong>{capability.available ? 'AI 模型已就绪' : 'AI 模型尚未配置'}</strong>
    <span>{capability.available
      ? `${capability.provider} · ${capability.model}`
      : 'API 启动时需设置 H3_SCRIPT_AI_ENDPOINT 与 H3_SCRIPT_AI_MODEL；导入功能不受影响。'}</span>
  </div>;
}

function ImportScriptForm({ busy, onImport }: {
  busy: boolean;
  onImport: (input: ImportScriptInput) => Promise<unknown>;
}) {
  const [title, setTitle] = useState('新剧本版本');
  const [format, setFormat] = useState<Exclude<ScriptSourceFormat,
    'legacy_text'>>('plain_text');
  const [content, setContent] = useState('');
  return <form className="script-entry-form" onSubmit={(event) => {
    event.preventDefault();
    void onImport({ format, title, content });
  }}>
    <label>新版本标题<input aria-label="新版本标题" value={title}
      onChange={(event) => setTitle(event.target.value)} /></label>
    <label>导入格式<select aria-label="导入格式" value={format}
      onChange={(event) => setFormat(event.target.value as typeof format)}>
      <option value="plain_text">普通剧本文本</option>
      <option value="shuohao_novel_script">shuohao novel-script JSON</option>
    </select></label>
    <label className="script-entry-wide">剧本内容<textarea aria-label="剧本内容"
      rows={12} placeholder="SC-01 雨巷 夜&#10;苏晚宁：今晚别走。&#10;顾承渊收起伞。"
      value={content} onChange={(event) => setContent(event.target.value)} /></label>
    <div className="script-entry-submit script-entry-wide">
      <p>导入不会调用 AI，内容会原样进入可编辑草稿。</p>
      <button className="button button-primary" type="submit"
        disabled={busy || content.trim().length === 0 || title.trim().length === 0}>
        导入为草稿
      </button>
    </div>
  </form>;
}
