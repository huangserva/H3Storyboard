import { ComfyUIClient, decodeCharacterImage } from
  '../packages/h3-provider/src/index.js';
import { ProjectStore } from '../packages/project-store/src/index.js';
import { CharacterImageLeaseWorker, SharedGpuCoordinator } from
  '../packages/task-engine/src/index.js';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

if (process.env.H3_CHARACTER_IMAGE_SMOKE !== '1') throw new Error(
  'Set H3_CHARACTER_IMAGE_SMOKE=1 to authorize real 4090 image submissions');

const evidenceDirectory = resolve(process.env.H3_CHARACTER_IMAGE_SMOKE_DIR ??
  '.hive/evidence/p13b-character-image-smoke');
const rootEvidence = JSON.parse(await readFile(
  join(evidenceDirectory, 'result.json'), 'utf8')) as RootEvidence;
const store = new ProjectStore(join(evidenceDirectory, 'storyboard.db'));

try {
  const imageClient = new ComfyUIClient({ endpoint:
    process.env.H3_IMAGE_COMFY_ENDPOINT ?? 'http://127.0.0.1:18188',
    poll_interval_ms: 2_000, poll_max_attempts: 180 });
  const h3Client = new ComfyUIClient({ endpoint:
    process.env.H3_COMFY_ENDPOINT ?? 'http://127.0.0.1:18190',
    poll_interval_ms: 2_000, poll_max_attempts: 180 });
  await assertStableIdle(imageClient, h3Client);
  store.characterMedia.approveReference(rootEvidence.project_id,
    rootEvidence.character_id, rootEvidence.job.output_reference_id,
    { make_primary: true });
  const coordinator = new SharedGpuCoordinator({ lease_store: store.gpuLeases,
    gpu_host: process.env.H3_GPU_HOST ?? 'newgpu:0',
    queue_clients: [imageClient, h3Client],
    managed_free_clients: [imageClient, h3Client], memory_client: imageClient,
    minimum_free_vram_bytes: 17 * 1024 ** 3,
    lease_duration_ms: 20 * 60_000, settle_ms: 3_000 });
  const worker = new CharacterImageLeaseWorker({ store, client: imageClient,
    gpu_coordinator: coordinator, data_directory: evidenceDirectory,
    lease_duration_ms: 20 * 60_000, idle_interval_ms: 1_000 });
  const identity = store.characterImageJobs.create(rootEvidence.project_id,
    rootEvidence.character_id, {
      operation: 'identity_edit', provider: 'local_comfyui',
      engine: 'qwen_image_edit_2511', prompt:
        'Preserve the exact same adult woman identity, face geometry, hair, age and dark navy coat. Three-quarter left view, closed mouth, neutral expression, neutral studio background, realistic skin, no text.',
      seed: 2026082402, width: 480, height: 864, steps: 4, cfg: 1,
      sampler: 'euler', scheduler: 'simple', denoise: 1,
      lora_profile: null, lora_name: null, lora_strength: null,
      source_reference_ids: [rootEvidence.job.output_reference_id],
      idempotency_key: `real-qwen-${crypto.randomUUID()}`,
    });
  const identityRun = await worker.runOnce();
  if (identityRun.outcome !== 'completed') throw new Error(
    `Real Qwen identity smoke failed: ${JSON.stringify(identityRun)}`);
  await assertStableIdle(imageClient, h3Client);
  const variant = store.characterImageJobs.create(rootEvidence.project_id,
    rootEvidence.character_id, {
      operation: 'variant_i2i', provider: 'local_comfyui', engine: 'krea2',
      prompt: 'cinematic full-body reference portrait of the same adult Chinese woman, stable oval face, straight black hair, exact dark navy long coat, closed mouth, neutral expression, soft side lighting, realistic skin, no text',
      seed: 2026082403, width: 480, height: 864, steps: 8, cfg: 1,
      sampler: 'euler_ancestral', scheduler: 'sgm_uniform', denoise: 0.52,
      lora_profile: null, lora_name: null, lora_strength: null,
      source_reference_ids: [rootEvidence.job.output_reference_id],
      idempotency_key: `real-krea-variant-${crypto.randomUUID()}`,
    });
  const variantRun = await worker.runOnce();
  if (variantRun.outcome !== 'completed') throw new Error(
    `Real Krea variant smoke failed: ${JSON.stringify(variantRun)}`);
  const records = await Promise.all([identity.id, variant.id].map(async (id) => {
    const job = store.characterImageJobs.get(id);
    const asset = store.getAsset(job.output_asset_id!);
    const decoded = await decodeCharacterImage(await readFile(
      join(evidenceDirectory, asset.relative_path)));
    return { job, asset, decoded };
  }));
  const reportPath = join(evidenceDirectory, 'derived-result.json');
  await writeFile(reportPath, `${JSON.stringify({ generated_at:
    new Date().toISOString(), root_job_id: rootEvidence.job.id,
    records }, null, 2)}\n`);
  process.stdout.write(`Real Qwen identity and Krea variant completed\n` +
    records.map(({ job, asset }) => `${job.operation}: ${job.provider_job_id}\n` +
      `Asset: ${join(evidenceDirectory, asset.relative_path)}`).join('\n') +
    `\nEvidence: ${reportPath}\n`);
} finally { store.close(); }

async function assertStableIdle(...clients: ComfyUIClient[]): Promise<void> {
  for (const client of clients) await client.assertQueueIdle();
  await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 2_000));
  for (const client of clients) await client.assertQueueIdle();
}

interface RootEvidence {
  project_id: string;
  character_id: string;
  job: { id: string; output_reference_id: string };
}
