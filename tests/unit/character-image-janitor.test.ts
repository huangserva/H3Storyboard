import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from
  'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { ProjectStore } from '../../packages/project-store/src/index.js';
import { quarantineOrphanedCharacterImages } from
  '../../packages/task-engine/src/index.js';

const directories: string[] = [];
const stores: ProjectStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(directories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })));
});

describe('character image orphan janitor', () => {
  test('quarantines old unreferenced files while preserving DB assets and fresh files',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'h3-image-janitor-'));
      directories.push(directory);
      const store = new ProjectStore(join(directory, 'storyboard.db'));
      stores.push(store);
      const project = store.createProject({ title: 'Janitor',
        script_title: 'Janitor', script_content: 'A complete janitor test.' });
      const base = join(directory, 'assets', 'characters', project.id,
        'generated');
      await mkdir(base, { recursive: true });
      const referenced = join(base, 'referenced.png');
      const orphan = join(base, 'orphan.png');
      const fresh = join(base, 'fresh.tmp');
      await Promise.all([
        writeFile(referenced, 'referenced'), writeFile(orphan, 'orphan'),
        writeFile(fresh, 'fresh'),
      ]);
      const old = new Date('2026-08-20T00:00:00.000Z');
      await Promise.all([utimes(referenced, old, old), utimes(orphan, old, old)]);
      store.createAsset(project.id, { kind: 'image',
        relative_path: `assets/characters/${project.id}/generated/referenced.png`,
        content_hash: `sha256:${'a'.repeat(64)}` });

      const result = await quarantineOrphanedCharacterImages(store, directory, {
        now: new Date('2026-08-24T00:00:00.000Z'), grace_period_ms: 24 * 60 * 60_000,
      });

      expect(result).toHaveLength(1);
      expect(result[0]?.source_relative_path).toContain('orphan.png');
      await expect(access(orphan)).rejects.toThrow();
      expect(await readFile(join(directory,
        result[0]!.quarantine_relative_path), 'utf8')).toBe('orphan');
      expect(await readFile(referenced, 'utf8')).toBe('referenced');
      expect(await readFile(fresh, 'utf8')).toBe('fresh');
    });
});
