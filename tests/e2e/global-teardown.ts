import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname } from 'node:path';

export default function globalTeardown(): void {
  const directory = process.env.H3_E2E_DIRECTORY;
  if (!directory || dirname(directory) !== tmpdir() ||
    !basename(directory).startsWith('h3-storyboard-e2e-')) return;
  rmSync(directory, { recursive: true, force: true });
}
