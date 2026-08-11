import type { AssetRole, ShotPlan } from '@h3storyboard/protocol';

interface ReferencePanelProps {
  shot: ShotPlan | null;
}

const slots: Array<{
  role: AssetRole;
  label: string;
  hint: string;
  glyph: string;
}> = [
  { role: 'character', label: '角色参考', hint: '人物一致性', glyph: '人' },
  { role: 'product', label: '物件参考', hint: '关键道具', glyph: '物' },
  { role: 'scene', label: '场景参考', hint: '空间与美术', glyph: '景' },
  { role: 'style', label: '风格参考', hint: '质感与色彩', glyph: '风' },
  { role: 'first_frame', label: '首帧', hint: '画面起点', glyph: '首' },
  { role: 'last_frame', label: '尾帧', hint: '画面终点', glyph: '尾' },
  { role: 'motion', label: '动作视频', hint: '动态参考', glyph: '动' },
  { role: 'audio', label: '音频', hint: '声音参考', glyph: '声' },
];

export function ReferencePanel({ shot }: ReferencePanelProps) {
  const bindings = shot?.reference_bindings ?? [];

  return (
    <aside className="reference-panel" aria-label="H3 参考资产">
      <header className="reference-heading">
        <div>
          <span className="eyebrow">H3 INPUTS</span>
          <h2>参考槽</h2>
        </div>
        <span className="binding-count">{bindings.length}/12</span>
      </header>
      <p className="reference-intro">提示词与上传文件使用同一绑定清单，未上传的参考不会写入任务。</p>

      <div className="reference-slots">
        {slots.map((slot) => {
          const count = bindings.filter((binding) => binding.role === slot.role).length;
          return (
            <div className="reference-slot" data-bound={count > 0} key={slot.role}>
              <span className="slot-glyph">{slot.glyph}</span>
              <div>
                <strong>{slot.label}</strong>
                <small>{count > 0 ? `已绑定 ${count} 项` : slot.hint}</small>
              </div>
              <span className="slot-state">{count > 0 ? 'READY' : 'EMPTY'}</span>
            </div>
          );
        })}
      </div>

      <div className="h3-readiness">
        <span>任务就绪度</span>
        <strong>{shot ? (shot.prompt ? '提示词已备' : '缺少提示词') : '未选镜头'}</strong>
        <div><i style={{ width: shot?.prompt ? '42%' : '8%' }} /></div>
      </div>
      <button className="button button-block" disabled type="button">绑定资产 · M1</button>
    </aside>
  );
}
