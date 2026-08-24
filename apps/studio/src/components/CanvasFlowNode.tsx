import { Handle, Position, type NodeProps } from '@xyflow/react';
import { assetFileUrl } from '../lib/api.js';
import { CanvasCharacterCard } from './CanvasCharacterCard.js';
import { CanvasShotCard } from './CanvasShotCard.js';
import type { StoryboardFlowNode } from './storyboard-flow-types.js';

export function CanvasFlowNode({ data, selected }: NodeProps<StoryboardFlowNode>) {
  const { view } = data;
  const handles = <><Handle type="target" position={Position.Left} />
    <Handle type="source" position={Position.Right} /></>;

  if (view.kind === 'shot' && view.shot) {
    const actuals = view.shot_actuals ?? [];
    const job = view.shot_jobs?.at(-1) ?? null;
    return <>{handles}<CanvasShotCard shot={view.shot} actuals={actuals}
      previewAsset={view.preview_asset ?? null} selected={selected}
      compileReady={data.preflight?.ready ?? false} busy={data.busy}
      job={job} preflight={data.preflight}
      onGenerate={(reason) => data.preflight
        ? data.onGenerate(view.shot!, data.preflight, reason)
        : Promise.resolve(false)} onSetup={data.onSetup} /></>;
  }

  if (view.kind === 'character' && view.character) {
    return <>{handles}<CanvasCharacterCard character={view.character}
      selected={selected} /></>;
  }

  if (view.kind === 'scene') {
    return <>{handles}<section className="flow-scene-node" data-selected={selected}>
      <span>{view.kicker}</span><strong>{view.title}</strong><small>{view.summary}</small>
    </section></>;
  }

  const preview = view.preview_asset ?? null;
  return <>{handles}<article className="flow-entity-node" data-kind={view.kind}
    data-status={view.status} data-selected={selected}>
    <header><span>{view.kicker}</span><i>{view.status}</i></header>
    {preview ? <div className="flow-entity-preview">
      {preview.kind === 'image' ? <img alt="" loading="lazy"
        src={assetFileUrl(preview.id)} /> : preview.kind === 'video'
        ? <video muted playsInline preload="metadata" src={assetFileUrl(preview.id)} />
        : null}
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
