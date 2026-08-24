import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const children = new Set<ChildProcess>();
const directories = new Set<string>();
const repositoryRoot = resolve(import.meta.dirname, '../..');

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  children.clear();
  await Promise.all(
    [...directories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  directories.clear();
});

describe('compiled API runtime', () => {
  it('starts the built Node entrypoint with dist package exports', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'h3-production-start-'));
    directories.add(directory);
    const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        H3_STORYBOARD_DB: join(directory, 'production.db'),
        H3_STORYBOARD_PORT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    const origin = await waitForOrigin(child);
    const response = await fetch(`${origin}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { status: 'ok', protocol_version: '1.4' },
    });

    child.kill('SIGTERM');
    expect(await waitForExit(child)).toBe(0);
    children.delete(child);
  });
});

function waitForOrigin(child: ChildProcess): Promise<string> {
  return new Promise((resolveOrigin, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Compiled API did not start. stderr: ${stderr}`));
    }, 10_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      const match = /listening at (http:\/\/[^\s]+)/.exec(stdout);
      if (!match?.[1]) return;
      clearTimeout(timeout);
      resolveOrigin(match[1]);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(
        new Error(`Compiled API exited before listening (${code}). ${stderr}`),
      );
    });
  });
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolveExit) => {
    child.once('exit', (code) => resolveExit(code));
  });
}
