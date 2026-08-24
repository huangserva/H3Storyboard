import { useState, type FormEvent } from 'react';
import type { AssetKind } from '@h3storyboard/protocol';
import { useAssets } from '../lib/use-assets.js';
import { AssetThumbnail } from './AssetThumbnail.js';

interface AssetLibraryPanelProps {
  projectId: string;
  forceOpen?: boolean;
  onClose?: () => void;
}

export function AssetLibraryPanel({ projectId, forceOpen = false,
  onClose }: AssetLibraryPanelProps) {
  const store = useAssets(projectId);
  const [open, setOpen] = useState(false);
  const [uri, setUri] = useState('');
  const [kind, setKind] = useState<AssetKind>('image');
  const expanded = forceOpen || open;
  const latestVersion = Math.max(0, ...store.manifests.map(
    ({ manifest }) => manifest.manifest_version,
  ));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await store.create({ kind, uri: uri.trim(), content_hash: null })) setUri('');
  };

  return (
    <aside aria-label="资产库" className="asset-library" data-open={expanded}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}>
      <header><div><span className="eyebrow">CURRENT ASSETS</span>
        <strong>资产库 · MANIFEST V{latestVersion || '—'}</strong></div>
        <button aria-label={forceOpen ? '收起资产库' : undefined} type="button"
          onClick={() => forceOpen ? onClose?.() : setOpen((current) => !current)}>
          {expanded ? '收起' : '展开'}</button></header>
      {expanded ? <>
        <form className="asset-form" onSubmit={submit}>
          <select value={kind} onChange={(event) => setKind(event.target.value as AssetKind)}>
            <option value="image">IMAGE</option><option value="video">VIDEO</option>
          </select>
          <input aria-label="资产 URI" required maxLength={2000} value={uri}
            onChange={(event) => setUri(event.target.value)} placeholder="references/scene.png" />
          <button disabled={store.busy} type="submit">登记</button>
        </form>
        {store.error ? <p className="asset-error" role="alert">{store.error}</p> : null}
        <div className="asset-list">
          {store.assets.length === 0 ? <p className="rail-empty">还没有登记资产</p> : null}
          {store.assets.map((asset) => <article key={asset.id} data-status={asset.status}>
            <header><span>{asset.kind}</span><i>{asset.status}</i></header>
            {asset.kind === 'image' ? <AssetThumbnail asset={asset} /> : null}
            <strong title={asset.uri}>{asset.uri}</strong>
            <footer>{asset.status === 'candidate' ? <button disabled={store.busy}
              type="button" onClick={() => void store.update({ asset_id: asset.id,
                status: 'approved' })}>APPROVE</button> : null}
              {asset.status !== 'archived' ? <button disabled={store.busy}
                type="button" onClick={() => void store.update({ asset_id: asset.id,
                  status: 'archived' })}>ARCHIVE</button> : null}</footer>
          </article>)}
        </div>
        <button className="asset-freeze" disabled={store.busy ||
          !store.assets.some(({ status }) => status === 'approved')}
          type="button" onClick={() => void store.freeze()}>
          冻结 CURRENT-ASSETS · NEXT V{latestVersion + 1}</button>
      </> : null}
    </aside>
  );
}
