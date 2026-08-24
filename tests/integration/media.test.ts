import Database from 'better-sqlite3';
import { mkdir, mkdtemp, readdir, rm, symlink, truncate, writeFile } from
  'node:fs/promises';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createApiServer, type ApiServer } from '../../apps/api/src/server.js';
import { openProjectStore } from '../../packages/project-store/src/index.js';

const servers = new Set<ApiServer>();
const directories = new Set<string>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  await Promise.all([...directories].map((directory) => rm(directory,
    { recursive: true, force: true })));
  servers.clear(); directories.clear();
});

describe('asset media HTTP endpoint with real files and SQLite', () => {
  test('streams a complete file and a byte range', async () => {
    const fixture = await createMediaFixture();
    const response = await fetch(`${fixture.origin}/api/assets/${fixture.assetId}/file`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(await response.text()).toBe('0123456789');

    const partial = await fetch(`${fixture.origin}/api/assets/${fixture.assetId}/file`,
      { headers: { range: 'bytes=2-5' } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(partial.headers.get('content-length')).toBe('4');
    expect(await partial.text()).toBe('2345');
  });

  test('returns stable errors for absent assets and missing files', async () => {
    const fixture = await createMediaFixture(false);
    const missingAsset = await fetch(
      `${fixture.origin}/api/assets/00000000-0000-4000-8000-000000000000/file`);
    expect(missingAsset.status).toBe(404);
    expect(await errorCode(missingAsset)).toBe('ASSET_NOT_FOUND');

    const missingFile = await fetch(
      `${fixture.origin}/api/assets/${fixture.assetId}/file`);
    expect(missingFile.status).toBe(404);
    expect(await errorCode(missingFile)).toBe('ASSET_FILE_NOT_FOUND');
  });

  test('defensively rejects a traversing path already present in SQLite', async () => {
    const fixture = await createMediaFixture(false, false);
    await fixture.server.close(); servers.delete(fixture.server);
    const raw = new Database(fixture.databasePath);
    raw.prepare('UPDATE assets SET relative_path = ? WHERE id = ?')
      .run('../outside.mp4', fixture.assetId);
    raw.close();
    const server = createApiServer({ database_path: fixture.databasePath, port: 0 });
    servers.add(server);
    const address = await server.start();

    const response = await fetch(`${address.origin}/api/assets/${fixture.assetId}/file`);
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe('ASSET_FILE_PATH_INVALID');
  });

  test('rejects a symlink that resolves outside the project data directory',
    async () => {
      const fixture = await createMediaFixture(false);
      const outside = await mkdtemp(join(tmpdir(), 'h3-media-outside-'));
      directories.add(outside);
      const outsideFile = join(outside, 'private.mp4');
      await writeFile(outsideFile, 'private');
      await mkdir(dirname(fixture.filePath), { recursive: true });
      await symlink(outsideFile, fixture.filePath);

      const response = await fetch(
        `${fixture.origin}/api/assets/${fixture.assetId}/file`);
      expect(response.status).toBe(422);
      expect(await errorCode(response)).toBe('ASSET_FILE_PATH_INVALID');
    });

  test('settles an aborted media response and keeps serving ranges', async () => {
    const fixture = await createMediaFixture();
    await truncate(fixture.filePath, 512 * 1024 * 1024);
    const fileDescriptorsBefore = await openFileDescriptorCount();
    const mediaUrl = `${fixture.origin}/api/assets/${fixture.assetId}/file`;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await abortAfterFirstChunk(mediaUrl);
    }
    await expect.poll(openFileDescriptorCount).toBeLessThanOrEqual(
      fileDescriptorsBefore + 3);

    const response = await fetch(mediaUrl, {
      headers: { range: 'bytes=0-31' },
    });
    expect(response.status).toBe(206);
    expect((await response.arrayBuffer()).byteLength).toBe(32);
  });
});

async function createMediaFixture(write = true, start = true) {
  const directory = await mkdtemp(join(tmpdir(), 'h3-media-'));
  directories.add(directory);
  const databasePath = join(directory, 'storyboard.db');
  const store = openProjectStore(databasePath);
  const project = store.createProject({ title: 'Media project', script_title: 'Media',
    script_content: 'A sufficiently complete script used for media endpoint tests.' });
  const relativePath = `projects/${project.id}/outputs/take.mp4`;
  const asset = store.createAsset(project.id, { kind: 'video', name: 'Take',
    relative_path: relativePath, content_hash: 'sha256:test' });
  store.close();
  if (write) {
    await mkdir(dirname(join(directory, relativePath)), { recursive: true });
    await writeFile(join(directory, relativePath), '0123456789');
  }
  const server = createApiServer({ database_path: databasePath, port: 0 });
  if (start) servers.add(server);
  const address = start ? await server.start() : { origin: '' };
  return { directory, databasePath, assetId: asset.id, server,
    origin: address.origin, filePath: join(directory, relativePath) };
}

function abortAfterFirstChunk(url: string): Promise<void> {
  return new Promise((resolveAbort, reject) => {
    const request = get(url, (response) => {
      response.once('data', () => response.destroy());
      response.once('close', resolveAbort);
      response.once('error', reject);
    });
    request.once('error', reject);
  });
}

async function openFileDescriptorCount(): Promise<number> {
  return (await readdir(process.platform === 'linux' ? '/proc/self/fd' :
    '/dev/fd')).length;
}

async function errorCode(response: Response) {
  return (await response.json() as { error: { code: string } }).error.code;
}
