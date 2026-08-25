import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { openProjectStore } from '../../packages/project-store/src/index.js';

const API_ORIGIN = process.env.H3_E2E_API_ORIGIN ?? 'http://127.0.0.1:4187';
const title = `P1.5B Canvas ${crypto.randomUUID().slice(0, 8)}`;
let projectId = '';
let shotIds: string[] = [];
let referenceAssetId = '';
let batchJobIds: string[] = [];

test.describe.serial('P1.5B canvas batch and semantic drag binding', () => {
  test.beforeAll(async ({ request }) => {
    ({ projectId, shotIds, referenceAssetId } = await seedReadyProject(request));
  });

  test('multi-selects plan nodes and creates one atomic H3 batch',
    async ({ page, request }) => {
      await openProject(page);
      await focusScene(page);
      await shotNode(page, shotIds[0]!).click();
      await shotNode(page, shotIds[1]!).click({ modifiers: ['Meta'] });

      const bar = page.getByRole('complementary', { name: '批量 H3 生成' });
      await expect(bar).toContainText('已选择2 镜');
      await expect(bar).toContainText('可生成 2');
      let droppedResponse = false;
      await page.route(`**/api/projects/${projectId}/jobs/batch`, async (route) => {
        if (!droppedResponse) {
          droppedResponse = true;
          await route.fetch();
          await route.abort('failed');
          return;
        }
        await route.continue();
      });
      await bar.getByRole('button', { name: '批量生成 2 镜' }).click();
      await expect.poll(async () => (await projectSnapshot(request)).h3_jobs.length)
        .toBe(2);
      await expect(bar).toBeVisible();
      const responsePromise = page.waitForResponse((response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/projects/${projectId}/jobs/batch`));
      await bar.getByRole('button', { name: '批量生成 2 镜' }).click();
      const response = await responsePromise;
      expect(response.status()).toBe(201);
      const body = (await response.json()) as { data: { items: Array<{
        shot_plan_id: string; job: { id: string; status: string;
          audio_mode: string } }> } };
      expect(body.data.items.map(({ shot_plan_id }) => shot_plan_id).sort())
        .toEqual([...shotIds].sort());
      expect(body.data.items.every(({ job }) => job.status === 'draft' &&
        job.audio_mode === 'h3_native')).toBe(true);
      batchJobIds = body.data.items.map(({ job }) => job.id);
      await expect(bar).toBeHidden();
      await page.unrouteAll({ behavior: 'wait' });

      const snapshot = await projectSnapshot(request);
      expect(snapshot.h3_jobs.filter(({ id }) => batchJobIds.includes(id)))
        .toHaveLength(2);
      await shotNode(page, shotIds[0]!).click();
      await shotNode(page, shotIds[1]!).click({ modifiers: ['Meta'] });
      await expect(bar).toContainText('进行中 2');
      await expect(bar.getByRole('button', { name: '批量生成 2 镜' }))
        .toBeDisabled();
      await bar.getByRole('button', { name: '清除选择' }).click();
    });

  test('drags a reference image and an approved Take boundary into Plan slots',
    async ({ page, request }) => {
      const continuity = prepareContinuitySource(batchJobIds[0]!);
      await openProject(page);
      await focusScene(page);

      const semanticResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/shots/${shotIds[1]}/bindings`));
      await dragHandle(page,
        page.locator(`.react-flow__node[data-id="asset:${referenceAssetId}"]`)
          .getByLabel('拖拽参考图'),
        shotNode(page, shotIds[1]!).getByLabel('绑定到尾帧'));
      expect((await semanticResponse).status()).toBe(200);
      await expect.poll(async () => (await projectSnapshot(request)).shot_plans
        .find(({ id }) => id === shotIds[1])?.semantic_references.some(
          ({ purpose, target }) => purpose === 'last_frame' &&
            target.type === 'asset' && target.asset_id === referenceAssetId))
        .toBe(true);

      const continuityResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/shots/${shotIds[1]}/bindings`));
      await dragHandle(page,
        page.locator(`.react-flow__node[data-id="take:${continuity.takeId}"]`)
          .getByLabel('拖拽Take 尾帧'),
        shotNode(page, shotIds[1]!).getByLabel('绑定到首帧'));
      expect((await continuityResponse).status()).toBe(200);
      const target = (await projectSnapshot(request)).shot_plans.find(
        ({ id }) => id === shotIds[1])!;
      expect(target.continuity_mode).toBe('chained');
      expect(target.continuity_dependencies).toContainEqual({
        source_shot_plan_id: shotIds[0], source_take_id: continuity.takeId,
        reference_asset_id: continuity.boundaryId, boundary: 'last_frame',
      });
    });
});

async function seedReadyProject(request: APIRequestContext) {
  const projectResponse = await request.post(`${API_ORIGIN}/api/projects`, {
    data: { title, script_title: 'P1.5B 画布测试剧本',
      script_content: '两个计划镜头必须通过真实画布完成批量 H3 入队与参考绑定。' },
  });
  expect(projectResponse.status()).toBe(201);
  const project = ((await projectResponse.json()) as { data: { id: string } })
    .data.id;
  const shots: string[] = [];
  for (let ordinal = 1; ordinal <= 2; ordinal += 1) {
    const response = await request.post(`${API_ORIGIN}/api/projects/${project}/shots`,
      { data: { title: `P1.5B 镜头 ${ordinal}`, scene_id: 'SC-01',
        duration_seconds: 5, shot_size: 'medium', camera_movement: 'locked',
        action: `人物完成动作 ${ordinal}。`, dialogue: '', sound: '',
        prompt: `Cinematic H3 shot ${ordinal}.`, continuity_mode: 'independent',
        continuity_dependencies: [], costume_state: {}, reference_bindings: [] } });
    expect(response.status()).toBe(201);
    shots.push(((await response.json()) as { data: { id: string } }).data.id);
  }
  const createdAsset = await request.post(`${API_ORIGIN}/api/projects/${project}/assets`,
    { data: { kind: 'image', name: 'P1.5B 参考图',
      uri: `refs/${crypto.randomUUID()}.png`, content_hash: null } });
  const asset = ((await createdAsset.json()) as { data: { id: string } }).data.id;
  expect((await request.patch(`${API_ORIGIN}/api/projects/${project}/assets`,
    { data: { asset_id: asset, status: 'approved' } })).status()).toBe(200);
  for (const shot of shots) {
    expect((await request.post(`${API_ORIGIN}/api/projects/${project}/shots/${shot}` +
      '/bindings', { data: { binding_type: 'semantic', purpose: 'first_frame',
        target: { type: 'asset', asset_id: asset } } })).status()).toBe(200);
  }
  const mode = `p15b-ui-${crypto.randomUUID().slice(0, 8)}`;
  expect((await request.post(`${API_ORIGIN}/api/modes`, { data: { key: mode,
    title: mode, description: 'P1.5B browser integration mode.',
    capability_declaration: { generation_modes: ['i2v'],
      duration_seconds: { min: 4, max: 15 }, resolution: { min_width: 480,
        max_width: 480, min_height: 864, max_height: 864 },
      lora_profile_requirements: [], provider_requirements: ['local_comfyui'],
      extensions: {} } } })).status()).toBe(201);
  expect((await request.post(`${API_ORIGIN}/api/projects/${project}/manifests`,
    { data: {} })).status()).toBe(201);
  expect((await request.post(`${API_ORIGIN}/api/projects/${project}/briefs`, {
    data: { mode_key: mode, body: { logline: 'P1.5B browser flow.',
      style_notes: 'Cinematic.', text_style_lock: null,
      hard_rules: ['Only H3-native audio or silence'] } } })).status()).toBe(201);
  expect((await request.put(`${API_ORIGIN}/api/projects/${project}/generation_lock`,
    { data: { engaged: true, reason: 'Ready for P1.5B batch' } })).status()).toBe(200);
  return { projectId: project, shotIds: shots, referenceAssetId: asset };
}

function prepareContinuitySource(jobId: string) {
  const databasePath = process.env.H3_E2E_DB;
  if (!databasePath) throw new Error('H3_E2E_DB is required');
  const store = openProjectStore(databasePath);
  try {
    store.production.updateLock(projectId, { engaged: false });
    const claimed = store.claimH3Job(jobId);
    store.markH3JobQueued(jobId, claimed.lease_token!, 'p15b-browser-provider');
    store.markH3JobRunning(jobId, claimed.lease_token!);
    const completed = store.finalizeWorkerOutput(jobId, claimed.lease_token!, {
      name: 'p15b-source.mp4', relative_path: 'outputs/p15b-source.mp4',
      content_hash: `sha256:${'3'.repeat(64)}`,
      observed_description: 'Approved source Take for canvas continuity.',
    });
    store.reviewShotActual(completed.actual.id, { qc_verdict: 'approved' });
    const boundary = store.createAsset(projectId, { kind: 'image',
      name: 'P1.5B source last frame', relative_path: 'outputs/p15b-last.png',
      content_hash: `sha256:${'4'.repeat(64)}`,
      derived_from_asset_id: completed.asset.id, derivation_kind: 'last_frame' });
    const approved = store.updateAsset(projectId, {
      asset_id: boundary.id, status: 'approved' });
    return { takeId: completed.actual.id, boundaryId: approved.id };
  } finally { store.close(); }
}

async function openProject(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(title) }).click();
  await page.getByRole('button', { name: '血缘流程', exact: true }).click();
  await expect(page.locator('.react-flow')).toBeVisible();
}

async function focusScene(page: Page): Promise<void> {
  await page.getByRole('button', { name: '聚焦当前场景' }).click();
  await expect(page.locator('.storyboard-flow'))
    .toHaveAttribute('data-scene-isolated', 'SC-01');
  await page.getByRole('button', { name: 'Fit View' }).click();
  await expect(shotNode(page, shotIds[0]!)).toBeInViewport();
}

function shotNode(page: Page, shotId: string) {
  return page.locator(`.react-flow__node[data-id="shot:${shotId}"]`);
}

async function dragHandle(page: Page, source: ReturnType<Page['locator']>,
  target: ReturnType<Page['locator']>) {
  const [sourceBox, targetBox] = await Promise.all([
    source.boundingBox(), target.boundingBox(),
  ]);
  if (!sourceBox || !targetBox) throw new Error('binding handles are not visible');
  await page.mouse.move(sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2, { steps: 12 });
  await page.mouse.up();
}

async function projectSnapshot(request: APIRequestContext) {
  const response = await request.get(`${API_ORIGIN}/api/projects/${projectId}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: {
    h3_jobs: Array<{ id: string }>;
    shot_plans: Array<{ id: string; continuity_mode: string;
      continuity_dependencies: Array<Record<string, string>>;
      semantic_references: Array<{ purpose: string;
        target: { type: 'asset' | 'character'; asset_id?: string } }> }>; } }).data;
}
