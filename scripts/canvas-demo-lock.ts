import { open, readFile, rm, stat, type FileHandle } from 'node:fs/promises';

const STALE_LOCK_MS = 30_000;
const ACQUIRE_ATTEMPTS = 200;

export async function withCanvasDemoLock<T>(databasePath: string,
  action: () => Promise<T>): Promise<T> {
  const lockPath = `${databasePath}.canvas-demo.lock`;
  const handle = await acquire(lockPath);
  try {
    return await action();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

async function acquire(lockPath: string): Promise<FileHandle> {
  for (let attempt = 0; attempt < ACQUIRE_ATTEMPTS; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx');
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid }));
        return handle;
      } catch (error) {
        await handle.close();
        await rm(lockPath, { force: true });
        throw error;
      }
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
      const info = await stat(lockPath).catch((statError: unknown) => {
        if (hasCode(statError, 'ENOENT')) return null;
        throw statError;
      });
      if (info && Date.now() - info.mtimeMs > STALE_LOCK_MS &&
        !(await ownerIsAlive(lockPath))) {
        await rm(lockPath, { force: true });
      } else {
        await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      }
    }
  }
  throw new Error(`Timed out acquiring canvas demo seed lock: ${lockPath}`);
}

async function ownerIsAlive(lockPath: string): Promise<boolean> {
  try {
    const owner = JSON.parse(await readFile(lockPath, 'utf8')) as { pid?: unknown };
    if (!Number.isSafeInteger(owner.pid)) return false;
    process.kill(owner.pid as number, 0);
    return true;
  } catch (error) {
    return hasCode(error, 'EPERM');
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
