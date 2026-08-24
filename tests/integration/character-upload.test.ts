import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CharacterCatalogSchema,
  CharacterReferenceUploadResultSchema,
  CharacterSchema,
  ProjectSchema,
} from '../../packages/protocol/src/index.js';
import { createApiServer, type ApiServer } from '../../apps/api/src/server.js';
import { afterEach, describe, expect, test } from 'vitest';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const WEBP_1X1 = Buffer.from(
  'UklGRiwAAABXRUJQVlA4ICAAAABwAQCdASoBAAEAAgA0JYwCdAGIQAD+3hJYYTBCpcAAAA==',
  'base64',
);

const servers = new Set<ApiServer>();
const directories = new Set<string>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  await Promise.all([...directories].map((directory) =>
    rm(directory, { recursive: true, force: true })));
  directories.clear();
});

describe('character reference upload HTTP and SQLite integration', () => {
  test('persists, replays, approves, and streams an uploaded image reference', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'h3-character-upload-'));
    directories.add(directory);
    const databasePath = join(directory, 'storyboard.db');
    const first = await startApi(databasePath, directory);
    const project = ProjectSchema.parse((await (await postJson(
      `${first.origin}/api/projects`, {
        title: 'Reference Upload', script_title: 'Reference Upload',
        script_content: 'A complete script used to test durable character images.',
      })).json() as { data: unknown }).data);
    const character = CharacterSchema.parse((await (await postJson(
      `${first.origin}/api/projects/${project.id}/characters`, {
        name: '苏婉宁', canonical_appearance: 'A Chinese woman in a fitted black coat.',
        seed_family: [20260824],
      })).json() as { data: unknown }).data);
    const uploadUrl = `${first.origin}/api/projects/${project.id}/characters/` +
      `${character.id}/reference_uploads`;

    const uploadedResponse = await uploadPng(uploadUrl, PNG_1X1, 'master-1');
    expect(uploadedResponse.status).toBe(201);
    const uploaded = CharacterReferenceUploadResultSchema.parse(
      (await uploadedResponse.json() as { data: unknown }).data,
    );
    expect(uploaded).toMatchObject({ replayed: false,
      asset: { kind: 'image', status: 'candidate', name: 'suwanning-master.png' },
      reference: { character_id: character.id, kind: 'image', sort_order: 0 } });
    expect(uploaded.reference.asset_id).toBe(uploaded.asset.id);
    expect(uploaded.reference.content_hash).toBe(uploaded.asset.content_hash);

    const media = await fetch(`${first.origin}/api/assets/${uploaded.asset.id}/file`);
    expect(media.status).toBe(200);
    expect(Buffer.from(await media.arrayBuffer())).toEqual(PNG_1X1);

    const replayResponse = await uploadPng(uploadUrl, PNG_1X1, 'master-1');
    expect(replayResponse.status).toBe(200);
    const replay = CharacterReferenceUploadResultSchema.parse(
      (await replayResponse.json() as { data: unknown }).data,
    );
    expect(replay).toEqual({ ...uploaded, replayed: true });

    const conflict = await uploadPng(
      uploadUrl, PNG_1X1, 'master-1', randomUUID());
    await expectError(conflict, 409, 'CHARACTER_REFERENCE_UPLOAD_CONFLICT');
    expect(await projectUploadFiles(directory, project.id)).toHaveLength(1);

    const assetUriRewrite = await patchJson(
      `${first.origin}/api/projects/${project.id}/assets`, {
        asset_id: uploaded.asset.id,
        uri: 'assets/characters/rewritten.png',
      });
    await expectError(assetUriRewrite, 409, 'ASSET_IMMUTABLE');
    const assetHashRewrite = await patchJson(
      `${first.origin}/api/projects/${project.id}/assets`, {
        asset_id: uploaded.asset.id,
        content_hash: 'rewritten-hash',
      });
    await expectError(assetHashRewrite, 409, 'ASSET_IMMUTABLE');
    const referenceUrl = `${first.origin}/api/projects/${project.id}/characters/` +
      `${character.id}/references`;
    for (const mutation of [
      { uri: 'assets/characters/rewritten.png' },
      { content_hash: 'rewritten-hash' },
      { kind: 'video' },
      { asset_id: randomUUID() },
    ]) {
      const rewrite = await patchJson(referenceUrl, {
        reference_id: uploaded.reference.id,
        ...mutation,
      });
      await expectError(rewrite, 409, 'CHARACTER_REFERENCE_IMMUTABLE');
    }
    const unchangedCatalog = CharacterCatalogSchema.parse((await (await fetch(
      `${first.origin}/api/projects/${project.id}/character_catalog`)).json() as {
        data: unknown;
      }).data);
    expect(unchangedCatalog.assets[0]).toMatchObject({
      id: uploaded.asset.id,
      uri: uploaded.asset.uri,
      content_hash: uploaded.asset.content_hash,
    });
    expect(unchangedCatalog.references[0]).toMatchObject({
      id: uploaded.reference.id,
      uri: uploaded.reference.uri,
      content_hash: uploaded.reference.content_hash,
    });

    const approval = await postJson(
      `${first.origin}/api/projects/${project.id}/characters/${character.id}` +
      `/references/${uploaded.reference.id}/approve`, { make_primary: true });
    expect(approval.status).toBe(200);
    expect((await approval.json() as { data: {
      asset: { status: string }; reference: { sort_order: number };
      manifest_stale: boolean;
    } }).data).toMatchObject({ asset: { status: 'approved' },
      reference: { sort_order: 0 }, manifest_stale: false });

    await first.server.close();
    servers.delete(first.server);
    const second = await startApi(databasePath, directory);
    const catalogResponse = await fetch(
      `${second.origin}/api/projects/${project.id}/character_catalog`,
    );
    const catalog = CharacterCatalogSchema.parse(
      (await catalogResponse.json() as { data: unknown }).data,
    );
    expect(catalog.references).toEqual([{ ...uploaded.reference }]);
    expect(catalog.assets).toMatchObject([{ id: uploaded.asset.id,
      status: 'approved' }]);
    const archived = await fetch(
      `${second.origin}/api/projects/${project.id}/assets`, { method: 'PATCH',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          asset_id: uploaded.asset.id, status: 'archived',
        }) });
    expect(archived.status).toBe(200);
    const reapproval = await postJson(
      `${second.origin}/api/projects/${project.id}/characters/${character.id}` +
      `/references/${uploaded.reference.id}/approve`, { make_primary: true });
    await expectError(reapproval, 409, 'ASSET_ARCHIVED');
  });

  test('rejects invalid image bytes without persisting a reference', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'h3-character-upload-bad-'));
    directories.add(directory);
    const api = await startApi(join(directory, 'storyboard.db'), directory);
    const project = ProjectSchema.parse((await (await postJson(
      `${api.origin}/api/projects`, {
        title: 'Bad Upload', script_title: 'Bad Upload',
        script_content: 'A complete script used to reject invalid character images.',
      })).json() as { data: unknown }).data);
    const character = CharacterSchema.parse((await (await postJson(
      `${api.origin}/api/projects/${project.id}/characters`, {
        name: '顾承远', canonical_appearance: 'A Chinese man in a charcoal raincoat.',
      })).json() as { data: unknown }).data);
    const response = await uploadPng(
      `${api.origin}/api/projects/${project.id}/characters/${character.id}` +
      '/reference_uploads', Buffer.from('not an image'), randomUUID());
    await expectError(response, 422, 'CHARACTER_IMAGE_INVALID');
    const truncated = await uploadPng(
      `${api.origin}/api/projects/${project.id}/characters/${character.id}` +
      '/reference_uploads', PNG_1X1.subarray(0, 32), randomUUID());
    await expectError(truncated, 422, 'CHARACTER_IMAGE_INVALID');
    const uploadUrl = `${api.origin}/api/projects/${project.id}/characters/` +
      `${character.id}/reference_uploads`;
    const unsupported = await fetch(uploadUrl, { method: 'POST', headers: {
      'content-type': 'image/gif', 'x-file-name': 'bad.gif',
      'x-idempotency-key': randomUUID(),
    }, body: Buffer.from('GIF89a') });
    await expectError(unsupported, 415, 'CHARACTER_IMAGE_TYPE_UNSUPPORTED');
    const empty = await uploadPng(uploadUrl, Buffer.alloc(0), randomUUID());
    await expectError(empty, 400, 'CHARACTER_IMAGE_REQUIRED');
    const missingHeader = await fetch(uploadUrl, { method: 'POST', headers: {
      'content-type': 'image/png', 'x-file-name': 'missing-key.png',
    }, body: PNG_1X1 });
    await expectError(missingHeader, 400, 'CHARACTER_UPLOAD_HEADER_INVALID');
    const unsafeName = await fetch(uploadUrl, { method: 'POST', headers: {
      'content-type': 'image/png', 'x-file-name': '../escape.png',
      'x-idempotency-key': randomUUID(),
    }, body: PNG_1X1 });
    await expectError(unsafeName, 400, 'CHARACTER_IMAGE_NAME_INVALID');
    const oversized = await uploadPng(uploadUrl,
      Buffer.alloc(15 * 1024 * 1024 + 1), randomUUID());
    await expectError(oversized, 413, 'CHARACTER_IMAGE_TOO_LARGE');
    const catalog = CharacterCatalogSchema.parse((await (await fetch(
      `${api.origin}/api/projects/${project.id}/character_catalog`)).json() as {
        data: unknown;
      }).data);
    expect(catalog.references).toEqual([]);
    expect(catalog.assets).toEqual([]);
    expect(await readdir(join(directory, 'assets', 'characters', project.id))
      .catch(() => [])).toEqual([]);
  });

  test('accepts and streams valid JPEG and WebP while rejecting truncation',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'h3-character-formats-'));
      directories.add(directory);
      const api = await startApi(join(directory, 'storyboard.db'), directory);
      const project = ProjectSchema.parse((await (await postJson(
        `${api.origin}/api/projects`, { title: 'Image formats',
          script_title: 'Image formats', script_content:
          'A complete script verifies supported character image formats.' },
      )).json() as { data: unknown }).data);
      const character = CharacterSchema.parse((await (await postJson(
        `${api.origin}/api/projects/${project.id}/characters`, {
          name: '苏婉宁', canonical_appearance: 'A stable character portrait.',
        })).json() as { data: unknown }).data);
      const url = `${api.origin}/api/projects/${project.id}/characters/` +
        `${character.id}/reference_uploads`;
      const jpeg = await readFile(new URL(
        '../fixtures/canvas-demo/su-wanning.jpg', import.meta.url));
      const formats = [
        { bytes: jpeg, mime: 'image/jpeg', name: 'portrait.jpg' },
        { bytes: WEBP_1X1, mime: 'image/webp', name: 'portrait.webp' },
      ];
      for (const format of formats) {
        const response = await uploadImage(url, format.bytes, randomUUID(),
          format.mime, format.name);
        expect(response.status).toBe(201);
        const uploaded = CharacterReferenceUploadResultSchema.parse(
          (await response.json() as { data: unknown }).data);
        expect(uploaded.asset.name).toBe(format.name);
        const media = await fetch(
          `${api.origin}/api/assets/${uploaded.asset.id}/file`);
        expect(media.status).toBe(200);
        expect(media.headers.get('content-type')).toBe(format.mime);
        expect(Buffer.from(await media.arrayBuffer())).toEqual(format.bytes);
        const truncated = await uploadImage(url,
          format.bytes.subarray(0, Math.floor(format.bytes.length / 2)),
          randomUUID(), format.mime, format.name);
        await expectError(truncated, 422, 'CHARACTER_IMAGE_INVALID');
      }
      expect(await projectUploadFiles(directory, project.id)).toHaveLength(2);
    });

  test('requires an approved same-character source and persists angle lineage',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'h3-character-angle-'));
      directories.add(directory);
      const api = await startApi(join(directory, 'storyboard.db'), directory);
      const project = ProjectSchema.parse((await (await postJson(
        `${api.origin}/api/projects`, { title: 'Angle lineage',
          script_title: 'Angle lineage', script_content:
          'A complete script used to verify durable multi-angle lineage.' },
      )).json() as { data: unknown }).data);
      const character = CharacterSchema.parse((await (await postJson(
        `${api.origin}/api/projects/${project.id}/characters`, {
          name: '苏婉宁', canonical_appearance: 'Approved identity master.',
        })).json() as { data: unknown }).data);
      const otherCharacter = CharacterSchema.parse((await (await postJson(
        `${api.origin}/api/projects/${project.id}/characters`, {
          name: '顾承远', canonical_appearance: 'A separate identity.',
        })).json() as { data: unknown }).data);
      const foreignProject = ProjectSchema.parse((await (await postJson(
        `${api.origin}/api/projects`, { title: 'Foreign angle lineage',
          script_title: 'Foreign angle lineage', script_content:
          'A complete script used to reject cross-project reference lineage.' },
      )).json() as { data: unknown }).data);
      const foreignCharacter = CharacterSchema.parse((await (await postJson(
        `${api.origin}/api/projects/${foreignProject.id}/characters`, {
          name: '异项目角色', canonical_appearance: 'A foreign project identity.',
        })).json() as { data: unknown }).data);
      const baseUrl = `${api.origin}/api/projects/${project.id}/characters`;
      const masterResponse = await uploadPng(
        `${baseUrl}/${character.id}/reference_uploads`, PNG_1X1, 'master');
      const master = CharacterReferenceUploadResultSchema.parse(
        (await masterResponse.json() as { data: unknown }).data);
      expect(await projectUploadFiles(directory, project.id)).toHaveLength(1);

      const candidateSource = await uploadPng(
        `${baseUrl}/${character.id}/reference_uploads`, PNG_1X1, 'angle-before',
        master.reference.id);
      await expectError(candidateSource, 422,
        'CHARACTER_REFERENCE_DERIVATION_INVALID');
      expect(await projectUploadFiles(directory, project.id)).toHaveLength(1);
      await postJson(`${baseUrl}/${character.id}/references/` +
        `${master.reference.id}/approve`, { make_primary: true });

      const angleResponse = await uploadPng(
        `${baseUrl}/${character.id}/reference_uploads`, PNG_1X1, 'angle-after',
        master.reference.id);
      expect(angleResponse.status).toBe(201);
      const angle = CharacterReferenceUploadResultSchema.parse(
        (await angleResponse.json() as { data: unknown }).data);
      expect(angle.reference.derived_from).toBe(master.reference.id);
      expect(angle.asset_derivation).toMatchObject({ asset_id: angle.asset.id,
        source_asset_id: master.asset.id, kind: 'character_angle_upload' });
      expect(await projectUploadFiles(directory, project.id)).toHaveLength(2);
      const rewriteLineage = await patchJson(
        `${baseUrl}/${character.id}/references`, {
          reference_id: angle.reference.id,
          derived_from: null,
        });
      await expectError(rewriteLineage, 409, 'CHARACTER_REFERENCE_IMMUTABLE');
      const forcePrimaryOrder = await patchJson(
        `${baseUrl}/${character.id}/references`, {
          reference_id: angle.reference.id,
          sort_order: 0,
        });
      await expectError(forcePrimaryOrder, 422,
        'CHARACTER_REFERENCE_DERIVATION_INVALID');
      await postJson(`${baseUrl}/${character.id}/references/` +
        `${angle.reference.id}/approve`, { make_primary: false });
      const promoteAngle = await postJson(
        `${baseUrl}/${character.id}/references/${angle.reference.id}/approve`,
        { make_primary: true });
      await expectError(promoteAngle, 422,
        'CHARACTER_REFERENCE_DERIVATION_INVALID');
      const catalogAfterPromotionAttempt = CharacterCatalogSchema.parse(
        (await (await fetch(
          `${api.origin}/api/projects/${project.id}/character_catalog`,
        )).json() as { data: unknown }).data,
      );
      expect(catalogAfterPromotionAttempt.references.map((reference) => ({
        id: reference.id,
        sort_order: reference.sort_order,
      }))).toEqual([
        { id: master.reference.id, sort_order: 0 },
        { id: angle.reference.id, sort_order: 1 },
      ]);
      const chainedAngle = await uploadPng(
        `${baseUrl}/${character.id}/reference_uploads`, PNG_1X1,
        'angle-from-angle', angle.reference.id);
      await expectError(chainedAngle, 422,
        'CHARACTER_REFERENCE_DERIVATION_INVALID');

      const archiveMaster = await patchJson(
        `${api.origin}/api/projects/${project.id}/assets`, {
          asset_id: master.asset.id,
          status: 'archived',
        });
      expect(archiveMaster.status).toBe(200);
      const approveAngleWithoutMaster = await postJson(
        `${baseUrl}/${character.id}/references/${angle.reference.id}/approve`,
        { make_primary: false });
      await expectError(approveAngleWithoutMaster, 422,
        'CHARACTER_REFERENCE_DERIVATION_INVALID');

      const crossCharacter = await uploadPng(
        `${baseUrl}/${otherCharacter.id}/reference_uploads`, PNG_1X1,
        'wrong-character', master.reference.id);
      await expectError(crossCharacter, 422,
        'CHARACTER_REFERENCE_DERIVATION_INVALID');
      expect(await projectUploadFiles(directory, project.id)).toHaveLength(2);
      const crossProject = await uploadPng(
        `${api.origin}/api/projects/${foreignProject.id}/characters/` +
        `${foreignCharacter.id}/reference_uploads`, PNG_1X1,
        'wrong-project', master.reference.id);
      await expectError(crossProject, 422,
        'CHARACTER_REFERENCE_PROJECT_MISMATCH');
      expect(await projectUploadFiles(directory, project.id)).toHaveLength(2);
      expect(await projectUploadFiles(directory, foreignProject.id)).toEqual([]);
      const catalog = CharacterCatalogSchema.parse((await (await fetch(
        `${api.origin}/api/projects/${project.id}/character_catalog`)).json() as {
          data: unknown;
        }).data);
      expect(catalog.asset_derivations).toEqual([angle.asset_derivation]);
      expect(catalog.references).toHaveLength(2);
  });

  test('serializes concurrent idempotent uploads to one asset and reference', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'h3-character-race-'));
    directories.add(directory);
    const api = await startApi(join(directory, 'storyboard.db'), directory);
    const project = ProjectSchema.parse((await (await postJson(
      `${api.origin}/api/projects`, { title: 'Concurrent upload',
        script_title: 'Concurrent upload', script_content:
        'A complete script used to verify upload idempotency races.' },
    )).json() as { data: unknown }).data);
    const character = CharacterSchema.parse((await (await postJson(
      `${api.origin}/api/projects/${project.id}/characters`, {
        name: '苏婉宁', canonical_appearance: 'One canonical identity.',
      })).json() as { data: unknown }).data);
    const url = `${api.origin}/api/projects/${project.id}/characters/` +
      `${character.id}/reference_uploads`;
    const responses = await Promise.all([
      uploadPng(url, PNG_1X1, 'same-key'),
      uploadPng(url, PNG_1X1, 'same-key'),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 201]);
    const results = await Promise.all(responses.map(async (response) =>
      CharacterReferenceUploadResultSchema.parse(
        (await response.json() as { data: unknown }).data)));
    expect(new Set(results.map(({ asset }) => asset.id)).size).toBe(1);
    expect(new Set(results.map(({ reference }) => reference.id)).size).toBe(1);
    const catalog = CharacterCatalogSchema.parse((await (await fetch(
      `${api.origin}/api/projects/${project.id}/character_catalog`)).json() as {
        data: unknown;
      }).data);
    expect(catalog.assets).toHaveLength(1);
    expect(catalog.references).toHaveLength(1);
  });

  test('approves replacement-backed references through the asset lifecycle',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'h3-character-replace-'));
      directories.add(directory);
      const api = await startApi(join(directory, 'storyboard.db'), directory);
      const project = ProjectSchema.parse((await (await postJson(
        `${api.origin}/api/projects`, { title: 'Replacement approval',
          script_title: 'Replacement approval', script_content:
          'A complete script used to preserve the asset replacement invariant.' },
      )).json() as { data: unknown }).data);
      const character = CharacterSchema.parse((await (await postJson(
        `${api.origin}/api/projects/${project.id}/characters`, {
          name: '苏婉宁', canonical_appearance: 'A canonical approved identity.',
        })).json() as { data: unknown }).data);
      const original = (await (await postJson(
        `${api.origin}/api/projects/${project.id}/assets`, {
          kind: 'image', name: 'original.png', relative_path: 'original.png',
          content_hash: null,
        })).json() as { data: { id: string } }).data;
      await patchJson(`${api.origin}/api/projects/${project.id}/assets`, {
        asset_id: original.id, status: 'approved',
      });
      const replacement = (await (await postJson(
        `${api.origin}/api/projects/${project.id}/assets`, {
          kind: 'image', name: 'replacement.png', relative_path: 'replacement.png',
          content_hash: null, replaces_asset_id: original.id,
        })).json() as { data: { id: string } }).data;
      const reference = (await (await postJson(
        `${api.origin}/api/projects/${project.id}/characters/` +
        `${character.id}/references`, { asset_id: replacement.id,
          uri: 'replacement.png', kind: 'image', content_hash: null,
          derived_from: null, sort_order: 0 },
      )).json() as { data: { id: string } }).data;
      const approval = await postJson(
        `${api.origin}/api/projects/${project.id}/characters/${character.id}` +
        `/references/${reference.id}/approve`, { make_primary: true });
      expect(approval.status).toBe(200);
      const assets = (await (await fetch(
        `${api.origin}/api/projects/${project.id}/assets`)).json() as { data: Array<{
          id: string; status: string;
        }> }).data;
      expect(assets.find(({ id }) => id === original.id)?.status).toBe('archived');
      expect(assets.find(({ id }) => id === replacement.id)?.status).toBe('approved');
    });
});

async function startApi(database_path: string, data_directory: string) {
  const server = createApiServer({ database_path, data_directory, port: 0 });
  servers.add(server);
  const address = await server.start();
  return { ...address, server };
}

function postJson(url: string, body: unknown) {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body) });
}

function patchJson(url: string, body: unknown) {
  return fetch(url, { method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body) });
}

function uploadPng(url: string, body: Buffer, key: string,
  derivedFrom: string | null = null) {
  return uploadImage(url, body, key, 'image/png', 'suwanning-master.png',
    derivedFrom);
}

function uploadImage(url: string, body: Buffer, key: string,
  contentType: string, fileName: string, derivedFrom: string | null = null) {
  return fetch(url, { method: 'POST', headers: { 'content-type': contentType,
    'x-file-name': fileName, 'x-idempotency-key': key,
    ...(derivedFrom ? { 'x-derived-from-reference-id': derivedFrom } : {}) }, body });
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}

async function projectUploadFiles(directory: string, projectId: string) {
  const files = await readdir(join(directory, 'assets', 'characters', projectId))
    .catch(() => []);
  expect(files.every((file) => !file.endsWith('.upload'))).toBe(true);
  return files;
}
