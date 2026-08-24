import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { seedCanvasDemo, type CanvasDemoResult } from
  '../../scripts/canvas-demo-fixture.js';

const API_ORIGIN = process.env.H3_E2E_API_ORIGIN ?? 'http://127.0.0.1:4187';
const DEMO_TITLE = '上海雨夜 · 画布体验项目';
let fixture: CanvasDemoResult;

test.describe.serial('canvas media director experience', () => {
  test.beforeAll(async () => {
    const databasePath = process.env.H3_E2E_DB;
    if (!databasePath) throw new Error('H3_E2E_DB is required');
    fixture = await seedCanvasDemo({ database_path: databasePath });
  });

  test('shows the real character, job, asset and Take lineage with lightboxes',
    async ({ page, request }) => {
      test.setTimeout(60_000);
      await openDemo(page);
      await page.getByRole('button', { name: 'Fit View' }).click();
      for (const id of [...fixture.character_ids.map((value) => `character:${value}`),
        ...fixture.shot_ids.map((value) => `shot:${value}`),
        ...fixture.job_ids.map((value) => `job:${value}`),
        ...fixture.output_asset_ids.map((value) => `asset:${value}`),
        ...fixture.actual_ids.map((value) => `take:${value}`)]) {
        await expect(page.locator(`.react-flow__node[data-id="${id}"]`))
          .toHaveCount(1);
      }

      const woman = page.locator(
        `.react-flow__node[data-id="character:${fixture.character_ids[0]}"]`);
      await expect(woman.getByRole('img', {
        name: /苏婉宁 approved reference/ })).toBeVisible();
      await woman.getByRole('heading', { name: '苏婉宁' }).click();
      const inspector = page.getByRole('complementary', { name: '节点详情' });
      await expect(inspector.getByRole('heading', { name: '苏婉宁' })).toBeVisible();
      await woman.getByRole('button', { name: '查看 苏婉宁 参考图' }).click();
      const imageDialog = page.getByRole('dialog', { name: /媒体预览/ });
      await expect(imageDialog).toBeVisible();
      await expect.poll(() => imageDialog.locator('img').evaluate(
        (image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
      await imageDialog.getByRole('button', { name: '关闭媒体预览' }).click();

      const currentTake = inspector.locator('dt', { hasText: '当前 Take' })
        .locator('xpath=following-sibling::dd[1]');
      for (const index of [0, 1]) {
        const takeNumber = index + 1;
        await page.getByRole('button', { name: 'Fit View' }).click();
        const job = page.locator(
          `.react-flow__node[data-id="job:${fixture.job_ids[index]}"]`);
        await job.getByRole('heading').click();
        await expect(currentTake).toHaveText(`TAKE ${takeNumber}`);

        await page.getByRole('button', { name: 'Fit View' }).click();
        const output = page.locator(
          `.react-flow__node[data-id="asset:${fixture.output_asset_ids[index]}"]`);
        await output.getByRole('heading').click();
        await expect(currentTake).toHaveText(`TAKE ${takeNumber}`);
        await output.getByRole('button', { name: /^打开 / }).click();
        const outputDialog = page.getByRole('dialog', { name: /媒体预览/ });
        await expect.poll(() => outputDialog.locator('video').evaluate(
          (video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
        await expect.poll(() => outputDialog.locator('video').evaluate(
          (video: HTMLVideoElement) => video.muted)).toBe(true);
        await outputDialog.getByRole('button', { name: '关闭媒体预览' }).click();

        await page.getByRole('button', { name: 'Fit View' }).click();
        const take = page.locator(
          `.react-flow__node[data-id="take:${fixture.actual_ids[index]}"]`);
        await take.getByRole('heading').click();
        await expect(inspector.getByRole('heading', {
          name: `TAKE ${takeNumber}` })).toBeVisible();
        await take.getByRole('button', { name: /^打开 / }).click();
        const takeDialog = page.getByRole('dialog', { name: /媒体预览/ });
        await expect(takeDialog).toContainText('静音');
        await expect.poll(() => takeDialog.locator('video').evaluate(
          (video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
        await takeDialog.getByRole('button', { name: '关闭媒体预览' }).click();
      }

      await page.getByRole('button', { name: /01 雨巷重逢 已有实测/ }).click();
      await expect(inspector.getByRole('heading', { name: '雨巷重逢' })).toBeVisible();
      await inspector.getByRole('button', { name: '全屏查看' }).click();
      const videoDialog = page.getByRole('dialog', { name: /媒体预览/ });
      await expect(videoDialog).toContainText('静音');
      await expect.poll(() => videoDialog.locator('video').evaluate(
        (video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
      const snapshot = await projectSnapshot(request);
      const secondOutput = snapshot.shot_actuals.find(
        ({ id }) => id === fixture.actual_ids[1])!.output_asset_id;
      const ranged = await request.get(
        `${API_ORIGIN}/api/assets/${secondOutput}/file`, {
          headers: { range: 'bytes=0-127' },
        });
      expect(ranged.status()).toBe(206);
      expect(ranged.headers()['content-type']).toBe('video/mp4');
      await videoDialog.getByRole('button', { name: '关闭媒体预览' }).click();

      const viewport = page.locator('.react-flow__viewport');
      await page.evaluate(() => new Promise<void>((resolveFrame) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))));
      await page.getByRole('button', { name: 'Fit View' }).click();
      await expect.poll(() => viewport.evaluate((element) => {
        const match = (element as HTMLElement).style.transform
          .match(/scale\(([-\d.]+)\)/);
        return match ? Number(match[1]) : 10;
      })).toBeLessThanOrEqual(0.9);
      const overviewTransform = await viewport.getAttribute('style');
      await page.getByRole('button', { name: /01 雨巷重逢 已有实测/ }).click();
      await expect.poll(() => viewport.getAttribute('style'))
        .not.toBe(overviewTransform);
    });

  test('switches Takes and persists QC and representative review without changing plan',
    async ({ page, request }) => {
      const before = await projectSnapshot(request);
      await openDemo(page);
      await page.getByRole('button', { name: '计划 / 实测' }).click();
      const taskDrawer = page.locator('.task-drawer');
      await expect(taskDrawer).toContainText('fixture-canvas-demo-take-02');
      await expect.poll(() => page.locator('.actual-preview video').evaluate(
        (video: HTMLVideoElement) => video.muted)).toBe(true);
      await page.getByRole('navigation', { name: '选择 Take' })
        .getByRole('button', { name: /^TAKE 01/ }).click();
      await expect(taskDrawer).toContainText('fixture-canvas-demo-take-01');
      await expect(taskDrawer).not.toContainText('fixture-canvas-demo-take-02');
      await page.getByRole('button', { name: '血缘流程', exact: true }).click();
      const inspector = page.getByRole('complementary', { name: '节点详情' });
      await inspector.getByRole('button', { name: /TAKE 01 · REP/ }).click();
      await expect(inspector).toContainText('当前 Take');
      await expect(inspector).toContainText('TAKE 1');
      await inspector.getByRole('button', { name: '撤销代表' }).click();
      await expect(page.getByText('已撤销代表 Take')).toBeVisible();

      await inspector.getByRole('button', { name: /^TAKE 02/ }).click();
      await inspector.getByRole('button', { name: 'APPROVE' }).click();
      await expect(page.getByText('Take QC 已批准')).toBeVisible();
      await expect(inspector).toContainText('QC · approved');
      await inspector.getByRole('button', { name: '标为代表 Take' }).click();
      await expect(page.getByText('已标记代表 Take')).toBeVisible();
      await inspector.getByRole('button', { name: '批准开闸' }).click();
      await expect(page.getByText('代表 Take 已批准')).toBeVisible();

      const after = await projectSnapshot(request);
      expect(after.shot_plans).toEqual(before.shot_plans);
      expect(after.shot_actuals.find(({ id }) => id === fixture.actual_ids[1]))
        .toMatchObject({ qc_verdict: 'approved', is_representative: true,
          representative_status: 'approved' });
      expect(after.shot_actuals.find(({ id }) => id === fixture.actual_ids[0]))
        .toMatchObject({ qc_verdict: 'approved', is_representative: false,
          representative_status: 'none' });

      await page.reload();
      await selectDemo(page);
      await page.getByRole('button', { name: /01 雨巷重逢 已有实测/ }).click();
      await inspector.getByRole('button', { name: /TAKE 02 · REP/ }).click();
      await expect(inspector).toContainText('REPRESENTATIVE · approved');
    });
});

async function openDemo(page: Page): Promise<void> {
  await page.goto('/');
  await selectDemo(page);
  await expect(shotNode(page)).toBeVisible();
}

async function selectDemo(page: Page): Promise<void> {
  await page.getByRole('button', { name: new RegExp(DEMO_TITLE) }).click();
  await page.getByRole('button', { name: '血缘流程', exact: true }).click();
  await expect(page.locator('.react-flow')).toBeVisible();
}

function shotNode(page: Page) {
  return page.locator(
    `.react-flow__node[data-id="shot:${fixture.shot_ids[0]}"]`);
}

async function projectSnapshot(request: APIRequestContext) {
  const response = await request.get(
    `${API_ORIGIN}/api/projects/${fixture.project_id}`);
  const body = await response.json() as { data: {
    shot_plans: unknown[];
    shot_actuals: Array<{ id: string; output_asset_id: string;
      qc_verdict: string; is_representative: boolean;
      representative_status: string }>;
  } };
  return body.data;
}
