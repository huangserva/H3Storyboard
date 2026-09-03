import type { H3PromptSpec } from '@h3storyboard/protocol';

interface H3PromptSpecFieldsProps {
  value: H3PromptSpec;
  onChange: (next: H3PromptSpec) => void;
}

/**
 * Structured H3 prompt (ADR 0003). The product never edits the final prompt:
 * h3-film-studio compiles these fields into MiniMax's official format. Body
 * fields are English; only dialogue text stays in its original language.
 */
export function H3PromptSpecFields({ value, onChange }: H3PromptSpecFieldsProps) {
  const set = <K extends keyof H3PromptSpec>(key: K, next: H3PromptSpec[K]) =>
    onChange({ ...value, [key]: next });
  const lines = value.lines;
  const setLine = (index: number, patch: Partial<H3PromptSpec['lines'][number]>) =>
    set('lines', lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  return (
    <fieldset className="prompt-spec">
      <legend>H3 结构化提示词（英文正文，台词原文）</legend>
      <div className="field-grid two-columns">
        <label>
          <span>风格 style</span>
          <input maxLength={120} required value={value.style}
            onChange={(event) => set('style', event.target.value)} />
        </label>
        <label>
          <span>运镜 camera</span>
          <input maxLength={300} value={value.camera}
            onChange={(event) => set('camera', event.target.value)} />
        </label>
      </div>
      <label>
        <span>首帧锚定 anchor（英文，引用 &lt;Picture 1&gt;）</span>
        <textarea required value={value.anchor}
          onChange={(event) => set('anchor', event.target.value)}
          placeholder="a close-up frames the young woman shown in <Picture 1> in a candlelit bedchamber…" />
      </label>
      <label>
        <span>动作节拍 beats（英文，每行一拍）</span>
        <textarea value={value.beats.join('\n')}
          onChange={(event) => set('beats', event.target.value.split('\n')
            .map((beat) => beat.trim()).filter(Boolean))} />
      </label>
      <label>
        <span>声景 soundscape（英文，环境声/动作声，不写台词）</span>
        <textarea required value={value.soundscape}
          onChange={(event) => set('soundscape', event.target.value)} />
      </label>
      <div className="prompt-spec-lines">
        <span>台词（正文英文；台词逐字进 &lt;d&gt;）</span>
        {lines.map((line, index) => (
          <div className="field-grid four-columns" key={index}>
            <input aria-label="说话人编号" maxLength={2} value={line.speaker}
              onChange={(event) => setLine(index, { speaker: event.target.value })} />
            <input aria-label="说话人身份与音色（英文）" maxLength={200} value={line.who}
              onChange={(event) => setLine(index, { who: event.target.value })} />
            <input aria-label="说话方式（英文动词）" maxLength={80} value={line.verb}
              onChange={(event) => setLine(index, { verb: event.target.value })} />
            <input aria-label="台词原文" maxLength={400} value={line.text}
              onChange={(event) => setLine(index, { text: event.target.value })} />
          </div>
        ))}
        <div>
          <button className="button button-ghost compact" type="button"
            onClick={() => set('lines', [...lines, { speaker: `S${lines.length + 1}`,
              who: '', verb: 'says', text: '', lang: 'Chinese', after: '' }])}>
            + 台词
          </button>
          {lines.length > 0 ? <button className="button button-ghost compact" type="button"
            onClick={() => set('lines', lines.slice(0, -1))}>− 台词</button> : null}
        </div>
      </div>
      <label>
        <span>静默人物 silent subjects（英文，每行一人；将写入官方闭唇句）</span>
        <textarea value={value.silent_subjects.join('\n')}
          onChange={(event) => set('silent_subjects', event.target.value.split('\n')
            .map((who) => who.trim()).filter(Boolean))} />
      </label>
    </fieldset>
  );
}
