import { useState, type FormEvent } from 'react';
import type { AssetKind } from '@h3storyboard/protocol';
import { useAssets } from '../lib/use-assets.js';
import { assetFileUrl } from '../lib/api.js';

export function AssetLibraryPanel({ projectId }: { projectId: string }) {
  const store = useAssets(projectId);
  const [open, setOpen] = useState(true);
  const [uri, setUri] = useState('');
  const [kind, setKind] = useState<AssetKind>('image');
  const latestVersion = Math.max(0, ...store.manifests.map(
    ({ manifest }) => manifest.manifest_version,
  ));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await store.create({ kind, uri: uri.trim(), content_hash: null })) setUri('');
  };

  return (
    <aside className="asset-library" data-open={open}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}>
      <header><div><span className="eyebrow">CURRENT ASSETS</span>
        <strong>资产库 · MANIFEST V{latestVersion || '—'}</strong></div>
        <button type="button" onClick={() => setOpen((current) => !current)}>
          {open ? '收起' : '展开'}</button></header>
      {open ? <>
        <form className="asset-form" onSubmit={submit}>
          <select value={kind} onChange={(event) => setKind(event.target.value as AssetKind)}>
            <option value="image">IMAGE</option><option value="video">VIDEO</option>
            <option value="audio">AUDIO</option>
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
            {asset.kind === 'image' ? <a className="asset-thumb" href={assetFileUrl(asset.id)}
              target="_blank" rel="noreferrer"><img loading="lazy" alt={asset.name}
                src={assetFileUrl(asset.id)} /></a> : null}
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
