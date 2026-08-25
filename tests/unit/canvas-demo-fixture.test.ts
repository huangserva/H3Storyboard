import { copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from
  'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openProjectStore } from '../../packages/project-store/src/index.js';
import { seedCanvasDemo } from '../../scripts/canvas-demo-fixture.js';

const directories = new Set<string>();

afterEach(async () => {
  await Promise.all([...directories].map((directory) =>
    rm(directory, { recursive: true, force: true })));
  directories.clear();
});

describe('canvas demo fixture with real SQLite and media files', () => {
  it('seeds an idempotent planned-to-actual graph without a worker', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'h3-canvas-demo-'));
    directories.add(directory);
    const databasePath = join(directory, 'canvas-test.db');

    const [first, concurrent] = await Promise.all([
      seedCanvasDemo({ database_path: databasePath }),
      seedCanvasDemo({ database_path: databasePath }),
    ]);
    const second = await seedCanvasDemo({ database_path: databasePath });

    expect(concurrent).toEqual(first);
    expect(second).toEqual(first);
    const store = openProjectStore(databasePath);
    try {
      expect(store.listProjects()).toHaveLength(1);
      const snapshot = store.getProjectSnapshot(first.project_id);
      expect(snapshot.shot_plans).toHaveLength(3);
      expect(snapshot.h3_jobs).toHaveLength(2);
      expect(snapshot.h3_jobs.every(({ audio_mode, status }) =>
        audio_mode === 'silent' && status === 'completed')).toBe(true);
      expect(snapshot.h3_jobs.map(({ duration_seconds }) => duration_seconds))
        .toEqual([10.125, 10.125]);
      expect(snapshot.shot_actuals.map(({ qc_verdict }) => qc_verdict))
        .toEqual(['approved', 'pending']);
      expect(snapshot.shot_actuals[0]).toMatchObject({
        is_representative: true,
        representative_status: 'approved',
      });
      expect(snapshot.assets).toContainEqual(expect.objectContaining({
        kind: 'image', status: 'approved', derivation_kind: 'last_frame',
        derived_from_asset_id: snapshot.shot_actuals[0]!.output_asset_id,
      }));
      expect(store.characters.list(first.project_id)).toHaveLength(2);
      expect(store.characters.listReferences(
        first.project_id, first.character_ids[0]!)).toHaveLength(1);
      expect(store.canvas.list(first.project_id)).toHaveLength(5);
      for (const asset of snapshot.assets) {
        if (!asset.relative_path) continue;
        expect((await stat(join(directory, asset.relative_path))).isFile())
          .toBe(true);
      }
    } finally {
      store.close();
    }
  });

  it('preserves user-added shots while resolving the seeded identities', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'h3-canvas-edited-'));
    directories.add(directory);
    const databasePath = join(directory, 'canvas-test.db');
    const first = await seedCanvasDemo({ database_path: databasePath });
    const store = openProjectStore(databasePath);
    try {
      store.createShotPlan(first.project_id, { title: '用户测试镜头',
        scene_id: 'SC-USER', duration_seconds: 5, shot_size: '中景',
        camera_movement: 'locked', action: '测试新增镜头是否保留。', dialogue: '',
        sound: '', prompt: 'User test shot.', continuity_mode: 'independent',
        continuity_dependencies: [], costume_state: {}, reference_bindings: [] });
    } finally {
      store.close();
    }

    expect(await seedCanvasDemo({ database_path: databasePath })).toEqual(first);
    const reopened = openProjectStore(databasePath);
    try {
      expect(reopened.getProjectSnapshot(first.project_id).shot_plans)
        .toHaveLength(4);
    } finally {
      reopened.close();
    }
  });

  it('refuses a partial active database without deleting it and supports a new path',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'h3-canvas-repair-'));
      directories.add(directory);
      const databasePath = join(directory, 'canvas-test.db');
      const first = await seedCanvasDemo({ database_path: databasePath });
      const database = new Database(databasePath);
      database.prepare('DELETE FROM canvas_nodes WHERE ref_id = ?')
        .run(first.shot_ids[0]);
      database.close();

      await expect(seedCanvasDemo({ database_path: databasePath }))
        .rejects.toMatchObject({ code: 'CANVAS_DEMO_LINEAGE_INCOMPLETE' });
      const store = openProjectStore(databasePath);
      try {
        expect(store.listProjects()).toHaveLength(1);
        expect(store.getProjectSnapshot(first.project_id).shot_plans)
          .toHaveLength(3);
      } finally {
        store.close();
      }
      const recovered = await seedCanvasDemo({ database_path: join(directory,
        'recovered-canvas-test.db') });
      expect(recovered.project_id).not.toBe(first.project_id);
    });

  it('removes a partial database when media installation fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'h3-canvas-copy-fail-'));
    directories.add(directory);
    const dataDirectory = join(directory, 'data');
    await mkdir(dataDirectory);
    await writeFile(join(dataDirectory, 'projects'), 'not a directory');
    const databasePath = join(directory, 'database', 'canvas-test.db');

    await expect(seedCanvasDemo({ database_path: databasePath,
      data_directory: dataDirectory })).rejects.toMatchObject({ code: 'ENOTDIR' });
    const store = openProjectStore(databasePath);
    try {
      expect(store.listProjects()).toEqual([]);
      expect(store.modes.list()).toEqual([]);
    } finally {
      store.close();
    }
  });

  it('rejects a fixture that declares an audio track before creating a database',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'h3-canvas-audio-reject-'));
      directories.add(directory);
      const fixtureDirectory = join(directory, 'fixtures');
      await mkdir(fixtureDirectory);
      const sourceDirectory = join(process.cwd(), 'tests/fixtures/canvas-demo');
      for (const name of ['su-wanning.jpg', 'gu-chengyuan.jpg',
        'rain-night-take-01-tail.png',
        'rain-night-take-02.mp4']) {
        await copyFile(join(sourceDirectory, name), join(fixtureDirectory, name));
      }
      const bytes = await readFile(join(sourceDirectory,
        'rain-night-take-01.mp4'));
      const handler = findVideoHandler(bytes);
      bytes.write('soun', handler, 4, 'ascii');
      await writeFile(join(fixtureDirectory, 'rain-night-take-01.mp4'), bytes);
      const databasePath = join(directory, 'rejected.db');

      await expect(seedCanvasDemo({ database_path: databasePath,
        fixture_directory: fixtureDirectory })).rejects.toMatchObject({
          code: 'CANVAS_DEMO_AUDIO_FORBIDDEN',
        });
      await expect(stat(databasePath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

  it('refuses to install media through a symlink outside the data directory',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'h3-canvas-link-root-'));
      const outside = await mkdtemp(join(tmpdir(), 'h3-canvas-link-outside-'));
      directories.add(directory);
      directories.add(outside);
      const databasePath = join(directory, 'canvas-test.db');
      const fixture = await seedCanvasDemo({ database_path: databasePath });
      const mediaDirectory = join(directory, 'projects', fixture.project_id,
        'canvas-demo');
      await rm(mediaDirectory, { recursive: true, force: true });
      await symlink(outside, mediaDirectory);

      await expect(seedCanvasDemo({ database_path: databasePath }))
        .rejects.toMatchObject({ code: 'CANVAS_DEMO_MEDIA_PATH_INVALID' });
      await expect(stat(join(outside, 'take-01-silent.mp4')))
        .rejects.toMatchObject({ code: 'ENOENT' });
    });
});

function findVideoHandler(bytes: Buffer): number {
  let offset = 0;
  while ((offset = bytes.indexOf('hdlr', offset, 'ascii')) >= 0) {
    if (bytes.toString('ascii', offset + 12, offset + 16) === 'vide') {
      return offset + 12;
    }
    offset += 4;
  }
  throw new Error('fixture has no video handler');
}
