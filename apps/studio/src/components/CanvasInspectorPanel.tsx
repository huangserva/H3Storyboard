import type { ProjectSnapshot } from '@h3storyboard/protocol';
import { assetFileUrl } from '../lib/api.js';
import type { StoryboardViewNode } from '../lib/storyboard-graph.js';

interface CanvasInspectorPanelProps {
  node: StoryboardViewNode | null;
  snapshot: ProjectSnapshot;
}

export function CanvasInspectorPanel({ node, snapshot }: CanvasInspectorPanelProps) {
  const preview = node?.preview_asset_id
    ? snapshot.assets.find(({ id }) => id === node.preview_asset_id) : null;
  return <aside className="canvas-inspector" aria-label="节点详情">
    <header><div><span className="eyebrow">NODE INSPECTOR</span>
      <strong>节点详情</strong></div><span className="audio-policy-badge">H3 AUDIO ONLY</span></header>
    {!node ? <div className="inspector-empty"><b>选择一个节点</b>
      <p>查看剧本、素材、分镜、H3 任务与 Take 的真实关系。</p></div> : <div className="inspector-content">
      <div className="inspector-title"><span>{node.kicker}</span><h2>{node.title}</h2>
        <i data-status={node.status}>{node.status}</i></div>
      {preview ? <div className="inspector-preview">
        {preview.kind === 'image' ? <img alt={preview.name} src={assetFileUrl(preview.id)} />
          : preview.kind === 'video' ? <video controls playsInline preload="metadata"
            src={assetFileUrl(preview.id)} /> : null}
      </div> : null}
      <p className="inspector-summary">{node.summary}</p>
      {node.script ? <dl><dt>脚本状态</dt><dd>{node.script.status}</dd>
        <dt>版本</dt><dd>V{node.script.version}</dd>
        <dt>内容</dt><dd>{node.script.content.slice(0, 420)}</dd></dl> : null}
      {node.shot ? <dl><dt>场景</dt><dd>{node.shot.scene_id}</dd>
        <dt>景别 / 运镜</dt><dd>{node.shot.shot_size} · {node.shot.camera_movement}</dd>
        <dt>时长</dt><dd>{node.shot.duration_seconds}s</dd>
        <dt>对白</dt><dd>{node.shot.dialogue || '无'}</dd>
        <dt>声音提示</dt><dd>{node.shot.sound || '无'}<small>仅作剧本记录，不会自动混音</small></dd>
        <dt>连续性</dt><dd>{node.shot.continuity_mode}</dd></dl> : null}
      {node.asset ? <dl><dt>素材类型</dt><dd>{node.asset.kind}</dd>
        <dt>清单状态</dt><dd>{node.asset.status}</dd>
        <dt>路径</dt><dd>{node.asset.uri}</dd></dl> : null}
      {node.character ? <dl><dt>角色状态</dt><dd>{node.character.status}</dd>
        <dt>Seed family</dt><dd>{node.character.seed_family.join(' / ') || 'UNSET'}</dd>
        <dt>Canonical appearance</dt><dd>{node.character.canonical_appearance}</dd></dl> : null}
      {node.job ? <dl><dt>生命周期</dt><dd>{node.job.status}</dd>
        <dt>模式 / 模型</dt><dd>{node.job.mode} · {node.job.model}</dd>
        <dt>声音策略</dt><dd>{node.job.audio_mode === 'h3_native'
          ? '仅保留 H3 原生输出声音' : '静音'}</dd>
        <dt>Provider ID</dt><dd>{node.job.provider_job_id ?? '尚未提交'}</dd>
        <dt>错误</dt><dd>{node.job.error_code ?? '无'}</dd></dl> : null}
      {node.take ? <dl><dt>QC</dt><dd>{node.take.qc_verdict}</dd>
        <dt>代表 Take</dt><dd>{node.take.representative_status}</dd>
        <dt>实测描述</dt><dd>{node.take.observed_description}</dd>
        <dt>偏差</dt><dd>{node.take.deviation_notes || '无'}</dd></dl> : null}
    </div>}
    <footer className="inspector-audio-rule"><strong>声音硬规则</strong>
      <p>最终视频只能使用 H3 原始输出中已有的声音，或保持静音。禁止 TTS、配音、音乐、环境声、雨声和音效叠加。</p>
    </footer>
  </aside>;
}
