import type { Asset, Project } from '@h3storyboard/protocol';
import { mkdir, readdir, rename, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';

export interface CharacterImageJanitorStore {
  listProjects(): Project[];
  listAssets(projectId: string): Asset[];
}

export interface CharacterImageJanitorOptions {
  grace_period_ms?: number;
  now?: Date;
}

export interface QuarantinedCharacterImage {
  source_relative_path: string;
  quarantine_relative_path: string;
}

const managedExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tmp']);

export async function quarantineOrphanedCharacterImages(
  store: CharacterImageJanitorStore,
  dataDirectory: string,
  options: CharacterImageJanitorOptions = {},
): Promise<QuarantinedCharacterImage[]> {
  const gracePeriodMs = options.grace_period_ms ?? 24 * 60 * 60_000;
  if (!Number.isSafeInteger(gracePeriodMs) || gracePeriodMs < 0) {
    throw new Error('Character image janitor grace period must be non-negative');
  }
  const now = options.now ?? new Date();
  const dataRoot = resolve(dataDirectory);
  const characterRoot = resolve(dataRoot, 'assets', 'characters');
  const referenced = new Set(store.listProjects().flatMap((project) =>
    store.listAssets(project.id).map((asset) => asset.relative_path)));
  const files = await listManagedFiles(characterRoot);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const quarantined: QuarantinedCharacterImage[] = [];
  for (const sourcePath of files) {
    const sourceRelative = portable(relative(dataRoot, sourcePath));
    if (referenced.has(sourceRelative)) continue;
    const info = await stat(sourcePath);
    if (now.getTime() - info.mtimeMs < gracePeriodMs) continue;
    const withinCharacterRoot = relative(characterRoot, sourcePath);
    const quarantinePath = resolve(characterRoot, '.orphaned', stamp,
      withinCharacterRoot);
    if (!quarantinePath.startsWith(`${characterRoot}${sep}`)) continue;
    await mkdir(dirname(quarantinePath), { recursive: true });
    await rename(sourcePath, quarantinePath);
    quarantined.push({
      source_relative_path: sourceRelative,
      quarantine_relative_path: portable(relative(dataRoot, quarantinePath)),
    });
  }
  return quarantined;
}

async function listManagedFiles(root: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === '.orphaned' || entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listManagedFiles(path));
    else if (entry.isFile() && managedExtensions.has(
      extname(entry.name).toLowerCase())) files.push(path);
  }
  return files;
}

function portable(path: string): string { return path.split(sep).join('/'); }
