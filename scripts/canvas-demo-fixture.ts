import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AssetBinding, CompiledBindingsResult,
  CreateH3JobInput, SemanticReference } from
  '../packages/protocol/src/index.js';
import { openProjectStore, type ProjectStore } from
  '../packages/project-store/src/index.js';
import { CanvasDemoError } from './canvas-demo-error.js';
import { withCanvasDemoLock } from './canvas-demo-lock.js';
import { installCanvasDemoMedia, loadCanvasDemoMedia,
  type CanvasDemoMediaSource, type InstalledMedia } from
  './canvas-demo-media.js';

const DEMO_TITLE = '上海雨夜 · 画布体验项目';
const DEFAULT_FIXTURE_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)),
  '../tests/fixtures/canvas-demo');

export interface CanvasDemoOptions {
  database_path: string;
  data_directory?: string;
  fixture_directory?: string;
}

export interface CanvasDemoResult {
  project_id: string;
  shot_ids: string[];
  character_ids: string[];
  job_ids: string[];
  output_asset_ids: string[];
  actual_ids: string[];
}

export async function seedCanvasDemo(
  options: CanvasDemoOptions,
): Promise<CanvasDemoResult> {
  const databasePath = resolve(options.database_path);
  const dataDirectory = resolve(options.data_directory ?? dirname(databasePath));
  const fixtureDirectory = resolve(
    options.fixture_directory ?? DEFAULT_FIXTURE_DIRECTORY);
  const source = await loadCanvasDemoMedia(fixtureDirectory);
  await Promise.all([mkdir(dirname(databasePath), { recursive: true }),
    mkdir(dataDirectory, { recursive: true })]);
  return withCanvasDemoLock(databasePath, () =>
    seedLocked(databasePath, dataDirectory, source));
}

async function seedLocked(databasePath: string, dataDirectory: string,
  source: CanvasDemoMediaSource): Promise<CanvasDemoResult> {
  const store = openProjectStore(databasePath);
  let createdProjectId: string | null = null;
  try {
    try {
      return store.runImmediate(() => {
        const projects = store.listProjects();
        const demos = projects.filter(({ title }) => title === DEMO_TITLE);
        if (demos.length === 1) {
          const result = existingFixture(store, demos[0]!.id, source);
          installCanvasDemoMedia(demos[0]!.id, dataDirectory, source);
          return result;
        }
        if (demos.length > 1) {
          throw new CanvasDemoError('CANVAS_DEMO_DUPLICATE_PROJECTS',
            'Canvas demo database contains duplicate demo projects');
        }
        if (projects.length > 0) {
          throw new CanvasDemoError('CANVAS_DEMO_DB_NOT_ISOLATED',
            'Canvas demo seed requires an isolated demo database');
        }
        return createFixture(store, dataDirectory, source,
          (projectId) => { createdProjectId = projectId; });
      });
    } catch (error) {
      if (createdProjectId) await removePath(join(dataDirectory, 'projects',
        createdProjectId, 'canvas-demo'));
      throw error;
    }
  } finally {
    store.close();
  }
}

async function removePath(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch (error) {
    if (!(error instanceof Error && 'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR'))) throw error;
  }
}

function existingFixture(store: ProjectStore, projectId: string,
  source: CanvasDemoMediaSource): CanvasDemoResult {
  const snapshot = store.getProjectSnapshot(projectId);
  const characters = store.characters.list(projectId);
  const shots = ['雨巷重逢', '并肩向前', '窗前停步'].map((title) =>
    snapshot.shot_plans.find((shot) => shot.title === title));
  const jobs = ['canvas-demo-take-01', 'canvas-demo-take-02'].map((key) =>
    snapshot.h3_jobs.find(({ idempotency_key }) => idempotency_key === key));
  const actuals = jobs.map((job) => snapshot.shot_actuals.find(
    ({ job_id }) => job_id === job?.id));
  const orderedCharacters = ['苏婉宁', '顾承远'].map((name) =>
    characters.find((character) => character.name === name));
  const expectedMedia = [source.woman_image, source.man_image,
    source.take_one, source.take_two];
  const mediaValid = expectedMedia.every((media) => snapshot.assets.some((asset) =>
    asset.relative_path === `projects/${projectId}/canvas-demo/${media.name}` &&
    asset.content_hash === media.content_hash));
  const canvasRefs = new Set(store.canvas.list(projectId).map(({ ref_id }) => ref_id));
  if ([...shots, ...jobs, ...actuals, ...orderedCharacters].some(
    (item) => item === undefined) || !mediaValid || jobs.some((job) =>
    job?.status !== 'completed' || job.audio_mode !== 'silent') ||
    ![...shots, ...orderedCharacters].every((item) => canvasRefs.has(item!.id))) {
    throw new CanvasDemoError('CANVAS_DEMO_LINEAGE_INCOMPLETE',
      'Canvas demo project exists but its seeded lineage is incomplete');
  }
  return { project_id: projectId,
    shot_ids: shots.map((shot) => shot!.id),
    character_ids: orderedCharacters.map((character) => character!.id),
    job_ids: jobs.map((job) => job!.id),
    output_asset_ids: actuals.map((actual) => actual!.output_asset_id),
    actual_ids: actuals.map((actual) => actual!.id) };
}

function createFixture(store: ProjectStore, dataDirectory: string,
  source: CanvasDemoMediaSource,
  onProjectCreated: (projectId: string) => void): CanvasDemoResult {
  ensureDemoMode(store);
  const project = store.createProject({ title: DEMO_TITLE,
    script_title: '上海雨夜 · 三镜导演测试版',
    script_content: '苏婉宁在上海雨夜遇见顾承远。两人从巷口走向旅店，计划镜头、H3 任务与每个实测 Take 必须保持独立。' });
  onProjectCreated(project.id);
  const media = installCanvasDemoMedia(project.id, dataDirectory, source);
  const womanImage = approveImage(store, project.id, '苏婉宁 · 身份参考',
    media.woman_image);
  const manImage = approveImage(store, project.id, '顾承远 · 身份参考',
    media.man_image);
  const woman = store.characters.create(project.id, { name: '苏婉宁',
    canonical_appearance: 'Chinese woman, late twenties, emerald qipao, low black hair bun with white flower hairpin, red lips, restrained expression.',
    seed_family: [1241, 4241], status: 'approved' });
  const man = store.characters.create(project.id, { name: '顾承远',
    canonical_appearance: 'Chinese man, early thirties, side-parted black hair, narrow moustache, charcoal three-piece suit with pocket-watch chain.',
    seed_family: [2381, 5381], status: 'approved' });
  store.characters.createReference(project.id, woman.id, {
    asset_id: womanImage.id, uri: womanImage.relative_path, kind: 'image',
    content_hash: womanImage.content_hash, derived_from: null, sort_order: 0 });
  store.characters.createReference(project.id, man.id, {
    asset_id: manImage.id, uri: manImage.relative_path, kind: 'image',
    content_hash: manImage.content_hash, derived_from: null, sort_order: 0 });
  store.freezeCurrentAssetsManifest(project.id);
  store.production.createBrief(project.id, { mode_key: 'canvas-demo-h3',
    body: { logline: '上海雨夜的克制相遇。',
      style_notes: '冷青雨夜、暖色窗光、写实电影质感；人物身份和服装连续。',
      text_style_lock: null,
      hard_rules: ['Plan 与 Actual 分离', '只允许 H3 原声或静音'] } });
  const shots = createShots(store, project.id, woman.id, man.id,
    womanImage.id, manImage.id);
  store.production.updateLock(project.id,
    { engaged: true, reason: 'Canvas demo fixture is immutable during testing' });

  const first = completeTake(store, shots[0]!.id, media.take_one,
    'canvas-demo-take-01', null);
  store.reviewShotActual(first.actual.id, { qc_verdict: 'approved' });
  store.takes.markRepresentative(first.actual.id, { representative: true });
  store.takes.reviewRepresentative(first.actual.id,
    { representative_status: 'approved' });
  const second = completeTake(store, shots[0]!.id, media.take_two,
    'canvas-demo-take-02', null);

  store.canvas.batchUpsert(project.id, { nodes: [
    canvasNode('character', woman.id, -420, 190, 1, 230, 210),
    canvasNode('character', man.id, -420, 460, 2, 230, 210),
    canvasNode('shot_plan', shots[0]!.id, 180, 180, 10),
    canvasNode('shot_plan', shots[1]!.id, 500, 180, 11),
    canvasNode('shot_plan', shots[2]!.id, 820, 180, 12),
  ] });
  return { project_id: project.id, shot_ids: shots.map(({ id }) => id),
    character_ids: [woman.id, man.id],
    job_ids: [first.job.id, second.job.id],
    output_asset_ids: [first.actual.output_asset_id, second.actual.output_asset_id],
    actual_ids: [first.actual.id, second.actual.id] };
}

function ensureDemoMode(store: ProjectStore): void {
  if (store.modes.list().some(({ key }) => key === 'canvas-demo-h3')) return;
  store.modes.create({ key: 'canvas-demo-h3', title: 'Canvas Demo · H3',
    description: 'Safe local canvas demo. Worker stays disabled.',
    capability_declaration: { generation_modes: ['t2v', 'i2v', 'fl2v', 'r2v'],
      duration_seconds: { min: 4, max: 15 }, resolution: { min_width: 480,
        max_width: 480, min_height: 864, max_height: 864 },
      lora_profile_requirements: [], provider_requirements: ['local_comfyui'],
      extensions: { demo_only: true } } });
}

function createShots(store: ProjectStore, projectId: string, womanId: string,
  manId: string, womanImageId: string, manImageId: string) {
  return [
    store.createShotPlan(projectId, shotInput('雨巷重逢', 'SC-01',
      '苏婉宁停在雨棚边，顾承远从巷口走近，两人在霓虹倒影中对视。',
      'slow push in', [{ purpose: 'first_frame', target: {
        type: 'asset', asset_id: womanImageId } }, {
        purpose: 'reference_character', target: {
          type: 'character', character_id: manId } }])),
    store.createShotPlan(projectId, shotInput('并肩向前', 'SC-01',
      '两人保持同一套服装，并肩穿过湿漉的石板路。', 'lateral tracking',
      [{ purpose: 'first_frame', target: { type: 'asset',
        asset_id: manImageId } }, { purpose: 'reference_character', target: {
        type: 'character', character_id: womanId } }])),
    store.createShotPlan(projectId, shotInput('窗前停步', 'SC-02',
      '暖色窗光落在两人侧脸，镜头停在未说出口的对白上。', 'locked off',
      [{ purpose: 'reference_character', target: {
        type: 'character', character_id: womanId } }])),
  ];
}

function shotInput(title: string, sceneId: string, action: string,
  camera: string, semanticReferences: SemanticReference[]) {
  return { title, scene_id: sceneId, duration_seconds: 10.125,
    shot_size: '中景', camera_movement: camera, action,
    dialogue: '', sound: '', prompt: `${title}, cinematic Shanghai rain night`,
    continuity_mode: 'independent' as const, continuity_dependencies: [],
    costume_state: { 苏婉宁: '墨绿色旗袍、白色花簪', 顾承远: '炭灰色三件套西装、怀表链' },
    reference_bindings: [], semantic_references: semanticReferences,
    opening_state: null, ending_state: null };
}

function completeTake(store: ProjectStore, shotId: string,
  media: InstalledMedia, idempotencyKey: string,
  gateOverrideReason: string | null) {
  const compiled = store.production.compileBindings(shotId);
  const job = store.createH3Job(shotId, jobInput(
    compiled, idempotencyKey, gateOverrideReason));
  const claimed = store.claimH3Job(job.id);
  const lease = claimed.lease_token;
  if (!lease) throw new Error('Canvas demo job did not receive a lease');
  store.markH3JobQueued(job.id, lease, `fixture-${idempotencyKey}`);
  store.markH3JobRunning(job.id, lease);
  return store.finalizeWorkerOutput(job.id, lease, { name: media.name,
    relative_path: media.relative_path, content_hash: media.content_hash,
    observed_description: media.observed_description });
}

function jobInput(compiled: CompiledBindingsResult, idempotencyKey: string,
  gateOverrideReason: string | null): CreateH3JobInput {
  const role: Record<CompiledBindingsResult['bindings'][number]['purpose'],
    AssetBinding['role']> = { first_frame: 'first_frame', last_frame: 'last_frame',
      reference_character: 'character', reference_prop: 'product',
      reference_composition: 'scene', reference_style: 'style',
      reference_stage: 'scene', reference_target_state: 'last_frame' };
  return { mode: compiled.generation_mode, provider: 'local_comfyui',
    model: 'MiniMax H3 · demo evidence',
    prompt: 'Cinematic Shanghai rain night, preserve both character identities.',
    duration_seconds: 10.125, seed: 419, steps: 28, audio_mode: 'silent',
    idempotency_key: idempotencyKey,
    input_bindings: compiled.bindings.map((binding, ordinal) => ({
      asset_id: binding.asset_id, asset_kind: 'image',
      role: role[binding.purpose], ordinal })),
    gate_override_reason: gateOverrideReason };
}

function approveImage(store: ProjectStore, projectId: string, name: string,
  media: InstalledMedia) {
  const asset = store.createAsset(projectId, { kind: 'image', name,
    relative_path: media.relative_path, content_hash: media.content_hash });
  return store.updateAsset(projectId, { asset_id: asset.id, status: 'approved' });
}

function canvasNode(nodeType: 'shot_plan' | 'character', refId: string,
  x: number, y: number, zIndex: number, width = 260, height = 196) {
  return { node_type: nodeType, ref_id: refId, x, y, width, height,
    z_index: zIndex };
}
