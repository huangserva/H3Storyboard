import { useState } from 'react';
import type { Asset } from '@h3storyboard/protocol';
import { assetFileUrl } from '../lib/api.js';

export function AssetThumbnail({ asset }: { asset: Asset }) {
  const [missing, setMissing] = useState(false);
  if (missing) return <div className="asset-thumb asset-thumb-missing">
    <span>文件缺失</span></div>;
  return <a className="asset-thumb" href={assetFileUrl(asset.id)}
    target="_blank" rel="noreferrer"><img loading="lazy" alt={asset.name}
      onError={() => setMissing(true)} src={assetFileUrl(asset.id)} /></a>;
}
