import { Handle, Position, type NodeProps } from '@xyflow/react';
import { assetFileUrl } from '../lib/api.js';
import { CanvasCharacterCard } from './CanvasCharacterCard.js';
import { CanvasShotCard } from './CanvasShotCard.js';
import type { StoryboardFlowNode } from './storyboard-flow-types.js';

export function CanvasFlowNode({ data, selected }: NodeProps<StoryboardFlowNode>) {
  const { view } = data;
  const handles = <><Handle id="lineage:target" isConnectable={false}
    type="target" position={Position.Left} />
    <Handle id="lineage:source" isConnectable={false}
      type="source" position={Position.Right} /></>;

  if (view.kind === 'shot' && view.shot) {
    const actuals = view.shot_actuals ?? [];
    const job = view.shot_jobs?.at(-1) ?? null;
    return <>{handles}{data.directorMode
      ? <ShotBindingTargets disabled={data.busy} /> : null}
      <CanvasShotCard shot={view.shot} actuals={actuals}
      previewAsset={view.preview_asset ?? null} selected={selected}
      directorMode={data.directorMode} mediaSlots={data.mediaSlots}
      compileReady={data.preflight?.ready ?? false} busy={data.busy}
      job={job} preflight={data.preflight}
      onGenerate={(reason) => data.preflight
        ? data.onGenerate(view.shot!, data.preflight, reason)
        : Promise.resolve(false)} onSetup={data.onSetup}
      onOpenMedia={data.onOpenMedia} /></>;
  }

  if (view.kind === 'character' && view.character) {
    return <>{handles}<BindingSourceHandles disabled={data.busy}
      sources={data.bindingSources} />
      <CanvasCharacterCard character={view.character}
      reference={data.characterReference} selected={selected}
      onOpenMedia={data.onOpenMedia} /></>;
  }

  if (view.kind === 'scene') {
    return <>{handles}<section className="flow-scene-node" data-selected={selected}>
      <span>{view.kicker}</span><strong>{view.title}</strong><small>{view.summary}</small>
      {data.directorMode ? <div className="scene-director-lane-guide"
        aria-hidden="true">
        <div><b>01 · REFERENCES</b><small>角色 / 场景 / 连续性参考</small></div>
        <div><b>02 · PLAN</b><small>首帧 / 尾帧 / 镜头意图</small></div>
        <div><b>03 · H3 ACTUAL</b><small>任务 / 输出 / TAKE / QC</small></div>
      </div> : null}
    </section></>;
  }

  const preview = view.preview_asset?.kind === 'image' ||
    view.preview_asset?.kind === 'video' ? view.preview_asset : null;
  return <>{handles}<BindingSourceHandles disabled={data.busy}
    sources={data.bindingSources} />
    <article className="flow-entity-node" data-kind={view.kind}
    data-status={view.status} data-selected={selected}>
    <header><span>{view.kicker}</span><i>{view.status}</i></header>
    {preview ? <div className="flow-entity-preview"><button
      aria-label={`打开 ${preview.name}`} className="canvas-media-trigger nodrag nopan"
      onClick={() => data.onOpenMedia(preview.id)} type="button">
      {preview.kind === 'image' ? <img alt="" loading="lazy"
        src={assetFileUrl(preview.id)} />
        : <video muted playsInline preload="metadata" src={assetFileUrl(preview.id)} />}
      </button>
    </div> : null}
    <h3>{view.title}</h3>
    <p>{view.summary}</p>
    {view.kind === 'job' && view.job ? <footer>
      <span>{view.job.audio_mode === 'h3_native' ? 'H3 原声' : '静音'}</span>
      <span>SEED {view.job.seed ?? 'AUTO'}</span>
    </footer> : null}
    {view.kind === 'take' && view.take ? <footer>
      <span>QC · {view.take.qc_verdict}</span>
      <span>{view.take.is_representative ? 'REPRESENTATIVE' : 'CANDIDATE'}</span>
    </footer> : null}
  </article></>;
}

function BindingSourceHandles({ sources, disabled }: {
  sources: StoryboardFlowNode['data']['bindingSources'];
  disabled: boolean;
}) {
  return <>{sources.map((source, index) => <div className="binding-source"
    key={source.handle_id} style={{ top: 74 + index * 34 }}>
    <span>{source.label}</span><Handle id={source.handle_id}
      aria-label={`拖拽${source.label}`} className="binding-handle binding-handle-source"
      isConnectable={!disabled} type="source" position={Position.Right} />
  </div>)}</>;
}

function ShotBindingTargets({ disabled }: { disabled: boolean }) {
  const targets = [
    ['first_frame', '首帧'],
    ['last_frame', '尾帧'],
    ['reference_character', '角色'],
  ] as const;
  return <>{targets.map(([purpose, label], index) =>
    <div className="binding-target" key={purpose} style={{ top: 94 + index * 62 }}>
      <Handle id={`target:${purpose}`} aria-label={`绑定到${label}`}
        className="binding-handle binding-handle-target" type="target"
        isConnectable={!disabled} position={Position.Left} /><span>{label}</span>
    </div>)}</>;
}
