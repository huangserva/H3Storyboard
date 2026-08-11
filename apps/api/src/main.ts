import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createApiServer } from './server.js';
import { ComfyUIClient } from '@h3storyboard/h3-provider';
import { openProjectStore } from '@h3storyboard/project-store';
import { H3LeaseWorker } from '@h3storyboard/task-engine';

const databasePath = process.env.H3_STORYBOARD_DB
  ? resolve(process.env.H3_STORYBOARD_DB)
  : join(homedir(), '.h3storyboard', 'h3storyboard.db');
const port = parsePort(process.env.H3_STORYBOARD_PORT);
mkdirSync(dirname(databasePath), { recursive: true });

const api = createApiServer({
  database_path: databasePath,
  port,
});
const address = await api.start();
process.stdout.write(`H3Storyboard API listening at ${address.origin}\n`);

const workerStore = process.env.H3_WORKER === '1'
  ? openProjectStore(databasePath) : null;
const worker = workerStore ? new H3LeaseWorker({
  store: workerStore,
  client: new ComfyUIClient({
    endpoint: process.env.H3_COMFY_ENDPOINT ?? 'http://127.0.0.1:8190',
    poll_interval_ms: parsePositiveInt(process.env.H3_WORKER_POLL_MS, 6_000),
    poll_max_attempts: parsePositiveInt(process.env.H3_WORKER_POLL_ATTEMPTS, 120),
  }),
  data_directory: process.env.H3_WORKER_DATA_DIR
    ? resolve(process.env.H3_WORKER_DATA_DIR) : dirname(databasePath),
  lease_duration_ms: parsePositiveInt(process.env.H3_WORKER_LEASE_MS, 3_600_000),
  idle_interval_ms: parsePositiveInt(process.env.H3_WORKER_IDLE_MS, 1_000),
  free_before_submit: process.env.H3_WORKER_FREE !== '0',
  on_error: (error) => process.stderr.write(
    `H3 worker error: ${error instanceof Error ? error.message : String(error)}\n`),
}) : null;
worker?.start();
if (worker) process.stdout.write('H3 worker enabled\n');

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await worker?.stop();
  workerStore?.close();
  await api.close();
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return 4187;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65_535) {
    throw new Error('H3_STORYBOARD_PORT must be an integer from 0 to 65535');
  }
  return value;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('H3 worker timing values must be positive integers');
  }
  return value;
}
