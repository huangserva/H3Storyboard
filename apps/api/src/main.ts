import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createApiServer } from './server.js';
import { ComfyUIClient } from '@h3storyboard/h3-provider';
import { openProjectStore } from '@h3storyboard/project-store';
import {
  CharacterImageLeaseWorker,
  H3LeaseWorker,
  SharedGpuCoordinator,
  quarantineOrphanedCharacterImages,
} from '@h3storyboard/task-engine';
import type { ScriptGenerationConfig } from './script-generation.js';

const databasePath = process.env.H3_STORYBOARD_DB
  ? resolve(process.env.H3_STORYBOARD_DB)
  : join(homedir(), '.h3storyboard', 'h3storyboard.db');
const port = parsePort(process.env.H3_STORYBOARD_PORT);
const dataDirectory = process.env.H3_WORKER_DATA_DIR
  ? resolve(process.env.H3_WORKER_DATA_DIR) : dirname(databasePath);
mkdirSync(dirname(databasePath), { recursive: true });

const workersEnabled = process.env.H3_WORKER !== '0';
const videoWorkerEnabled = workersEnabled && process.env.H3_VIDEO_WORKER !== '0';
const imageWorkerEnabled = workersEnabled && process.env.H3_IMAGE_WORKER !== '0';
const workerStore = videoWorkerEnabled || imageWorkerEnabled
  ? openProjectStore(databasePath) : null;
const h3Endpoint = process.env.H3_COMFY_ENDPOINT ?? 'http://127.0.0.1:8190';
const imageEndpoint = process.env.H3_IMAGE_COMFY_ENDPOINT ??
  'http://127.0.0.1:8188';
const h3Client = workerStore ? new ComfyUIClient({ endpoint: h3Endpoint,
    poll_interval_ms: parsePositiveInt(process.env.H3_WORKER_POLL_MS, 6_000),
    poll_max_attempts: parsePositiveInt(process.env.H3_WORKER_POLL_ATTEMPTS, 120),
  }) : null;
const imageClient = workerStore ? new ComfyUIClient({ endpoint: imageEndpoint,
    poll_interval_ms: parsePositiveInt(
      process.env.H3_IMAGE_WORKER_POLL_MS, 6_000),
    poll_max_attempts: parsePositiveInt(
      process.env.H3_IMAGE_WORKER_POLL_ATTEMPTS, 120),
  }) : null;
const managedEndpoints = new Set(parseList(
  process.env.H3_MANAGED_COMFY_ENDPOINTS)
  .map(normalizeEndpoint));
const coordinator = workerStore && h3Client && imageClient
  ? new SharedGpuCoordinator({ lease_store: workerStore.gpuLeases,
    gpu_host: process.env.H3_GPU_HOST ?? 'newgpu:0',
    queue_clients: [imageClient, h3Client],
    managed_free_clients: [imageClient, h3Client].filter(({ endpoint }) =>
      managedEndpoints.has(endpoint)), memory_client: imageClient,
    minimum_free_vram_bytes: Math.round(parsePositiveNumber(
      process.env.H3_GPU_MIN_FREE_GIB, 17) * 1024 ** 3),
    lease_duration_ms: parsePositiveInt(
      process.env.H3_GPU_LEASE_MS, 3_600_000),
    settle_ms: parseNonNegativeInt(process.env.H3_GPU_SETTLE_MS, 1_000),
  }) : null;
const h3Worker = videoWorkerEnabled && workerStore && h3Client && coordinator
  ? new H3LeaseWorker({
  store: workerStore, client: h3Client, gpu_coordinator: coordinator,
  data_directory: process.env.H3_WORKER_DATA_DIR
    ? resolve(process.env.H3_WORKER_DATA_DIR) : dirname(databasePath),
  lease_duration_ms: parsePositiveInt(process.env.H3_WORKER_LEASE_MS, 3_600_000),
  idle_interval_ms: parsePositiveInt(process.env.H3_WORKER_IDLE_MS, 1_000),
  free_before_submit: false,
  on_error: (error) => process.stderr.write(
    `H3 worker error: ${error instanceof Error ? error.message : String(error)}\n`),
}) : null;
const imageWorker = imageWorkerEnabled && workerStore && imageClient && coordinator
  ? new CharacterImageLeaseWorker({ store: workerStore, client: imageClient,
    gpu_coordinator: coordinator, data_directory: dataDirectory,
    lease_duration_ms: parsePositiveInt(
      process.env.H3_IMAGE_WORKER_LEASE_MS, 3_600_000),
    idle_interval_ms: parsePositiveInt(
      process.env.H3_IMAGE_WORKER_IDLE_MS, 1_000),
    on_error: (error) => process.stderr.write(
      `Image worker error: ${error instanceof Error ? error.message : String(error)}\n`),
  }) : null;

if (workerStore) {
  const quarantined = await quarantineOrphanedCharacterImages(
    workerStore, dataDirectory, { grace_period_ms: Math.round(
      parsePositiveNumber(process.env.H3_IMAGE_ORPHAN_GRACE_HOURS, 24) *
      60 * 60_000) });
  if (quarantined.length > 0) process.stdout.write(
    `Quarantined ${quarantined.length} orphaned character image files\n`);
}

const api = createApiServer({ database_path: databasePath, port,
  data_directory: dataDirectory,
  ...scriptGenerationOptions(),
  character_image_lora_allowlist: parseList(
    process.env.H3_CHARACTER_IMAGE_LORA_ALLOWLIST),
  ...(imageWorker ? { cancel_character_image_job: (jobId: string,
    reason: string) => imageWorker.cancel(jobId, reason) } : {}),
});
let address;
try { address = await api.start(); }
catch (error) { workerStore?.close(); throw error; }
process.stdout.write(`H3Storyboard API listening at ${address.origin}\n`);
h3Worker?.start();
imageWorker?.start();
if (h3Worker || imageWorker) process.stdout.write(
  `${h3Worker ? 'H3 video' : ''}${h3Worker && imageWorker ? ' and ' : ''}` +
  `${imageWorker ? 'character image' : ''} worker` +
  `${h3Worker && imageWorker ? 's' : ''} enabled with shared GPU lease\n`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await Promise.all([h3Worker?.stop(), imageWorker?.stop()]);
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

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(
    'H3 worker timing values must be non-negative integers');
  return value;
}

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(
    'H3 worker numeric values must be positive');
  return value;
}

function parseList(raw: string | undefined): string[] {
  return raw?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
}

function normalizeEndpoint(value: string): string {
  return value.replace(/\/+$/, '');
}

function scriptGenerationOptions(): {
  script_generation?: ScriptGenerationConfig;
} {
  const endpoint = process.env.H3_SCRIPT_AI_ENDPOINT?.trim();
  const model = process.env.H3_SCRIPT_AI_MODEL?.trim();
  if (!endpoint && !model) return {};
  if (!endpoint || !model) throw new Error(
    'H3_SCRIPT_AI_ENDPOINT and H3_SCRIPT_AI_MODEL must be configured together');
  return { script_generation: {
    endpoint,
    model,
    ...(process.env.H3_SCRIPT_AI_API_KEY?.trim()
      ? { api_key: process.env.H3_SCRIPT_AI_API_KEY.trim() } : {}),
    ...(process.env.H3_SCRIPT_AI_PROVIDER?.trim()
      ? { provider: process.env.H3_SCRIPT_AI_PROVIDER.trim() } : {}),
    timeout_ms: parsePositiveInt(
      process.env.H3_SCRIPT_AI_TIMEOUT_MS,
      120_000,
    ),
  } };
}
