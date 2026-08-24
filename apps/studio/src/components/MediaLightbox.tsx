import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Asset } from '@h3storyboard/protocol';
import { assetFileUrl } from '../lib/api.js';

interface MediaLightboxProps {
  asset: Asset;
  onClose: () => void;
}

export function MediaLightbox({ asset, onClose }: MediaLightboxProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return createPortal(
    <div className="media-lightbox-backdrop" role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}>
      <section aria-label={`媒体预览 ${asset.name}`} aria-modal="true"
        className="media-lightbox" role="dialog">
        <header><div><span className="eyebrow">CANONICAL MEDIA</span>
          <strong>{asset.name}</strong></div>
          <div><span className="audio-policy-badge">H3 原声 / 静音</span>
            <button aria-label="关闭媒体预览" className="icon-button"
              onClick={onClose} type="button">×</button></div></header>
        <div className="media-lightbox-stage">
          {asset.kind === 'image'
            ? <img alt={asset.name} src={assetFileUrl(asset.id)} />
            : asset.kind === 'video' ? <video controls playsInline preload="metadata"
              src={assetFileUrl(asset.id)} />
              : <p>外部音频资产不能进入 H3 画布播放链路。</p>}
        </div>
        <footer><span>{asset.kind.toUpperCase()} · {asset.status}</span>
          <p>视频只播放 H3 输出中已有的原声；没有原声时保持静音。</p></footer>
      </section>
    </div>,
    document.body,
  );
}
