import { useEffect, useState } from 'react';
import type { Asset, CharacterReference, ProjectSnapshot } from '@h3storyboard/protocol';
import { assetFileUrl } from '../lib/api.js';
import { allowsH3NativeAudio } from '../lib/h3-audio-policy.js';
import type { StoryboardViewNode } from '../lib/storyboard-graph.js';
import { CanvasTakeControls } from './CanvasTakeControls.js';
import { PolicyVideo } from './PolicyVideo.js';

interface CanvasInspectorPanelProps {
  node: StoryboardViewNode | null;
  snapshot: ProjectSnapshot;
  assets: Asset[];
  busy: boolean;
  characterReference: CharacterReference | null;
  onClose?: () => void;
  onOpenMedia: (assetId: string) => void;
  onReviewActual: (actualId: string,
    verdict: 'approved' | 'rejected') => Promise<boolean>;
  onMarkRepresentative: (actualId: string,
    representative: boolean) => Promise<boolean>;
  onReviewRepresentative: (actualId: string,
    status: 'approved' | 'rejected') => Promise<boolean>;
}

export function CanvasInspectorPanel({ node, snapshot, assets, busy, characterReference,
  onClose, onOpenMedia, onReviewActual, onMarkRepresentative,
  onReviewRepresentative }: CanvasInspectorPanelProps) {
  const shotActuals = snapshot.shot_actuals.filter(
    ({ shot_plan_id }) => shot_plan_id === node?.shot_id,
  ).sort((left, right) => left.attempt_number - right.attempt_number);
  const relatedActuals = node?.job
    ? shotActuals.filter(({ job_id }) => job_id === node.job?.id)
    : node?.asset_role === 'output' && node.asset
      ? shotActuals.filter(({ output_asset_id }) => output_asset_id === node.asset?.id)
      : node?.shot || node?.take ? shotActuals : [];
  const defaultActual = node?.take ?? relatedActuals.at(-1) ?? null;
  const [selectedActualId, setSelectedActualId] = useState<string | null>(null);
  useEffect(() => setSelectedActualId(defaultActual?.id ?? null),
    [defaultActual?.id, node?.id]);
  const actual = relatedActuals.find(({ id }) => id === selectedActualId)
    ?? defaultActual;
  const previewAssetId = actual?.output_asset_id ?? node?.preview_asset_id
    ?? characterReference?.asset_id ?? null;
  const previewCandidate = previewAssetId
    ? assets.find(({ id }) => id === previewAssetId) ?? null : null;
  const preview = previewCandidate?.kind === 'image' ||
    previewCandidate?.kind === 'video' ? previewCandidate : null;
  const previewAudioAllowed = preview
    ? allowsH3NativeAudio(preview, snapshot.h3_jobs) : false;

  return <aside className="canvas-inspector" aria-label="节点详情">
    <header><div><span className="eyebrow">NODE INSPECTOR</span>
      <strong>节点详情</strong></div><div className="canvas-inspector-actions">
      <span className="audio-policy-badge">H3 AUDIO ONLY</span>
      {onClose ? <button aria-label="关闭节点详情" onClick={onClose}
        type="button">×</button> : null}</div></header>
    {!node ? <div className="inspector-empty"><b>选择一个节点</b>
      <p>查看剧本、素材、分镜、H3 任务与 Take 的真实关系。</p></div> : <div className="inspector-content">
      <div className="inspector-title"><span>{node.kicker}</span><h2>{node.title}</h2>
        <i data-status={node.status}>{node.status}</i></div>
      {preview ? <div className="inspector-preview">
        {preview.kind === 'image'
          ? <img alt={preview.name} src={assetFileUrl(preview.id)} />
          : <PolicyVideo allowH3Audio={previewAudioAllowed}
            src={assetFileUrl(preview.id)} />}
        <button className="inspector-preview-open" onClick={() => onOpenMedia(preview.id)}
          type="button">全屏查看</button>
      </div> : null}
      <p className="inspector-summary">{node.summary}</p>
      {node.script ? <dl><dt>脚本状态</dt><dd>{node.script.status}</dd>
        <dt>版本</dt><dd>V{node.script.version}</dd>
        <dt>内容</dt><dd>{node.script.content.slice(0, 420)}</dd></dl> : null}
      {node.shot ? <dl><dt>场景</dt><dd>{node.shot.scene_id}</dd>
        <dt>景别 / 运镜</dt><dd>{node.shot.shot_size} · {node.shot.camera_movement}</dd>
        <dt>时长</dt><dd>{node.shot.duration_seconds}s</dd>
        <dt>对白</dt><dd>{node.shot.dialogue || '无'}</dd>
        <dt>声音提示</dt><dd>{node.shot.sound || '无'}
          <small>仅作剧本记录，不会自动混音</small></dd>
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
      {actual ? <><dl><dt>当前 Take</dt><dd>TAKE {actual.attempt_number}</dd>
        <dt>QC</dt><dd>{actual.qc_verdict}</dd>
        <dt>代表 Take</dt><dd>{actual.representative_status}</dd>
        <dt>实测描述</dt><dd>{actual.observed_description}</dd>
        <dt>偏差</dt><dd>{actual.deviation_notes || '无'}</dd></dl>
        <CanvasTakeControls actual={actual} actuals={relatedActuals} busy={busy}
          onSelect={setSelectedActualId} onReviewActual={onReviewActual}
          onMarkRepresentative={onMarkRepresentative}
          onReviewRepresentative={onReviewRepresentative} /></> : null}
    </div>}
    <footer className="inspector-audio-rule"><strong>声音硬规则</strong>
      <p>最终视频只能使用 H3 原始输出中已有的声音，或保持静音。禁止 TTS、配音、音乐、环境声、雨声和音效叠加。</p>
    </footer>
  </aside>;
}
