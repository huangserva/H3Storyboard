import { useState, type FormEvent } from 'react';
import type { CreateProjectInput } from '@h3storyboard/protocol';

interface ProjectComposerProps {
  busy: boolean;
  onClose: () => void;
  onCreate: (input: CreateProjectInput) => Promise<boolean>;
}

export function ProjectComposer({ busy, onClose, onCreate }: ProjectComposerProps) {
  const [title, setTitle] = useState('');
  const [scriptTitle, setScriptTitle] = useState('');
  const [scriptContent, setScriptContent] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const created = await onCreate({
      title: title.trim(),
      script_title: scriptTitle.trim(),
      script_content: scriptContent.trim(),
    });
    if (created) onClose();
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-labelledby="new-project-title"
        aria-modal="true"
        className="composer-card project-composer"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="composer-header">
          <div>
            <span className="eyebrow">PROJECT INTAKE</span>
            <h2 id="new-project-title">建立导演项目</h2>
          </div>
          <button aria-label="关闭" className="icon-button" onClick={onClose} type="button">
            ×
          </button>
        </header>

        <form className="composer-form" onSubmit={submit}>
          <div className="intake-note">
            <span>01</span>
            <div>
              <strong>完整剧本优先</strong>
              <p>首版以整份剧本建立 Script V1，保存后锁定，避免半段输入污染分镜。</p>
            </div>
          </div>

          <div className="field-grid two-columns">
            <label>
              <span>项目名称</span>
              <input
                autoFocus
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：雨夜来信"
                required
                value={title}
              />
            </label>
            <label>
              <span>剧本标题</span>
              <input
                maxLength={160}
                onChange={(event) => setScriptTitle(event.target.value)}
                placeholder="剧本正式标题"
                required
                value={scriptTitle}
              />
            </label>
          </div>

          <label>
            <span>完整剧本内容</span>
            <textarea
              className="script-textarea"
              minLength={20}
              onChange={(event) => setScriptContent(event.target.value)}
              placeholder={'请粘贴完整剧本\n\n场景、人物、动作、对白都应保留。'}
              required
              value={scriptContent}
            />
            <small>{scriptContent.trim().length} 字符 · 最少 20</small>
          </label>

          <footer className="composer-footer">
            <span>数据仅写入本机</span>
            <div>
              <button className="button button-ghost" onClick={onClose} type="button">
                取消
              </button>
              <button className="button button-primary" disabled={busy} type="submit">
                {busy ? '正在建立…' : '锁定剧本并建立'}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
