import type { ScriptVersion } from '@h3storyboard/protocol';

interface CanvasEmptyGuideProps {
  busy: boolean;
  script: ScriptVersion;
  onManualShot: () => void;
  onOpenScript: () => void;
}

export function CanvasEmptyGuide({ busy, script, onManualShot,
  onOpenScript }: CanvasEmptyGuideProps) {
  return <section className="canvas-empty" aria-label="空画布引导">
    <span>START HERE · P2.2</span><h2>下一步：打开剧本工作台</h2>
    <p>不需要在空画布里猜流程。先完成结构化剧本、校验、编译与审核；批准后，完整血缘会自动出现。</p>
    <ol className="canvas-empty-steps" aria-label="分镜建立进度">
      <li data-state="done"><b>01</b><div><strong>剧本入口已就绪</strong>
        <small>V{script.version} · {script.title}</small></div></li>
      <li data-state="current"><b>02</b><div><strong>完成剧本与分镜审核</strong>
        <small>当前步骤</small></div></li>
      <li><b>03</b><div><strong>批准后进入画布</strong>
        <small>自动建立血缘</small></div></li>
    </ol>
    <div className="canvas-empty-actions">
      <button className="button button-primary" disabled={busy}
        onClick={onOpenScript} type="button">打开剧本工作台</button>
      <button className="button" disabled={busy} onClick={onManualShot}
        type="button">手工新增镜头</button>
    </div>
  </section>;
}
