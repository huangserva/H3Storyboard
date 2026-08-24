import { ComfyUIClient, decodeCharacterImage } from
  '../packages/h3-provider/src/index.js';
import { ProjectStore } from '../packages/project-store/src/index.js';
import { CharacterImageLeaseWorker, SharedGpuCoordinator } from
  '../packages/task-engine/src/index.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

if (process.env.H3_CHARACTER_IMAGE_SMOKE !== '1') throw new Error(
  'Set H3_CHARACTER_IMAGE_SMOKE=1 to authorize a real 4090 image submission');

const evidenceDirectory = resolve(process.env.H3_CHARACTER_IMAGE_SMOKE_DIR ??
  '.hive/evidence/p13b-character-image-smoke');
const databasePath = join(evidenceDirectory, 'storyboard.db');
const imageEndpoint = process.env.H3_IMAGE_COMFY_ENDPOINT ??
  'http://127.0.0.1:18188';
const h3Endpoint = process.env.H3_COMFY_ENDPOINT ?? 'http://127.0.0.1:18190';
await mkdir(evidenceDirectory, { recursive: true });
const store = new ProjectStore(databasePath);

try {
  const imageClient = new ComfyUIClient({ endpoint: imageEndpoint,
    poll_interval_ms: 2_000, poll_max_attempts: 120 });
  const h3Client = new ComfyUIClient({ endpoint: h3Endpoint,
    poll_interval_ms: 2_000, poll_max_attempts: 120 });
  await assertStableIdle(imageClient, h3Client);
  const before = await imageClient.assertFreeVram(0);
  const project = store.createProject({ title: `P1.3B 4090 smoke ${Date.now()}`,
    script_title: 'P1.3B Character Image Smoke',
    script_content: 'A durable real-Krea role-image generation smoke test.' });
  const character = store.characters.create(project.id, { name: '林澜测试角色',
    canonical_appearance: '成年中国女性，稳定的椭圆脸、黑色直发、深蓝色长外套，闭嘴、中性表情。',
    seed_family: [2026082401], status: 'approved' });
  const job = store.characterImageJobs.create(project.id, character.id, {
    operation: 'master_t2i', provider: 'local_comfyui', engine: 'krea2',
    prompt: 'cinematic full-body reference portrait of a fictional adult Chinese woman, stable oval face, straight black hair, dark navy long coat, closed mouth, neutral expression, natural hands, realistic skin, neutral studio background, consistent wardrobe, no text',
    seed: 2026082401, width: 480, height: 864, steps: 8, cfg: 1,
    sampler: 'euler_ancestral', scheduler: 'sgm_uniform', denoise: null,
    lora_profile: null, lora_name: null, lora_strength: null,
    source_reference_ids: [], idempotency_key: `real-krea-${crypto.randomUUID()}`,
  });
  const coordinator = new SharedGpuCoordinator({ lease_store: store.gpuLeases,
    gpu_host: process.env.H3_GPU_HOST ?? 'newgpu:0',
    queue_clients: [imageClient, h3Client],
    managed_free_clients: [imageClient, h3Client], memory_client: imageClient,
    minimum_free_vram_bytes: 17 * 1024 ** 3,
    lease_duration_ms: 15 * 60_000, settle_ms: 3_000 });
  const worker = new CharacterImageLeaseWorker({ store, client: imageClient,
    gpu_coordinator: coordinator, data_directory: evidenceDirectory,
    lease_duration_ms: 15 * 60_000, idle_interval_ms: 1_000 });
  const result = await worker.runOnce();
  const persisted = store.characterImageJobs.get(job.id);
  if (result.outcome !== 'completed' || !persisted.output_asset_id) throw new Error(
    `Real character image smoke failed: ${JSON.stringify(result)}`);
  const asset = store.getAsset(persisted.output_asset_id);
  const decoded = await decodeCharacterImage(await readFile(
    join(evidenceDirectory, asset.relative_path)));
  const after = await imageClient.assertFreeVram(0);
  const report = { generated_at: new Date().toISOString(), image_endpoint: imageEndpoint,
    h3_endpoint: h3Endpoint, project_id: project.id, character_id: character.id,
    job: persisted, asset, decoded, gpu_before: before, gpu_after: after };
  const reportPath = join(evidenceDirectory, 'result.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Real character image completed\nProject: ${project.id}\n` +
    `Job: ${job.id}\nAsset: ${join(evidenceDirectory, asset.relative_path)}\n` +
    `Evidence: ${reportPath}\n`);
} finally {
  store.close();
}

async function assertStableIdle(...clients: ComfyUIClient[]): Promise<void> {
  for (const client of clients) await client.assertQueueIdle();
  await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 2_000));
  for (const client of clients) await client.assertQueueIdle();
}
