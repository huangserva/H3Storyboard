import { expect, test, type Page } from '@playwright/test';
import { seedCanvasDemo, type CanvasDemoResult } from
  '../../scripts/canvas-demo-fixture.js';

const DEMO_TITLE = '上海雨夜 · 画布体验项目';
let fixture: CanvasDemoResult;

test.describe.serial('immersive storyboard canvas', () => {
  test.beforeAll(async () => {
    const databasePath = process.env.H3_E2E_DB;
    if (!databasePath) throw new Error('H3_E2E_DB is required');
    fixture = await seedCanvasDemo({ database_path: databasePath });
  });

  test('uses focus mode, drawers and F/Escape without losing the canvas',
    async ({ page }) => {
      await openDemo(page);
      const shell = page.locator('.app-shell');
      const canvas = page.locator('.canvas-layout');
      await page.getByRole('button', { name: '打开资产抽屉' }).click();
      await expect(page.locator('.asset-library')).toBeVisible();
      await page.keyboard.press('f');

      await expect(shell).toHaveAttribute('data-canvas-focus', 'true');
      await expect(canvas).toHaveAttribute('data-focus', 'true');
      await expect(page.locator('.asset-library')).toBeHidden();
      await expect(page.locator('.app-header')).toBeHidden();
      await expect(page.locator('.project-rail')).toBeHidden();
      await expect(page.locator('.workbench-toolbar')).toBeHidden();
      await expect(page.getByRole('complementary', { name: '节点详情' })).toBeHidden();

      await shotNode(page).getByRole('heading', { name: '雨巷重逢' }).click();
      await expect(page.getByRole('button', { name: '关闭节点详情' })).toBeVisible();
      await page.getByRole('button', { name: '关闭节点详情' }).click();
      await expect(page.getByRole('button', { name: '聚焦当前场景' })).toBeFocused();

      await page.getByRole('button', { name: '打开资产抽屉' }).click();
      await expect(page.getByRole('complementary', { name: '节点详情' })).toBeHidden();
      await expect(page.locator('.asset-library')).toBeVisible();
      await page.getByLabel('资产 URI').focus();
      await page.keyboard.press('f');
      await page.keyboard.press('Escape');
      await expect(shell).toHaveAttribute('data-canvas-focus', 'true');
      await page.getByRole('button', { name: '关闭资产抽屉' }).click();
      await expect(page.locator('.asset-library')).toBeHidden();
      await expect(page.getByRole('button', { name: '打开资产抽屉' })).toBeFocused();

      await shotNode(page).getByRole('button', { name: /^打开 / }).click();
      const mediaDialog = page.getByRole('dialog', { name: /^媒体预览 / });
      await expect(mediaDialog).toBeVisible();
      await page.keyboard.press('f');
      await expect(shell).toHaveAttribute('data-canvas-focus', 'true');
      await page.keyboard.press('Escape');
      await expect(mediaDialog).toBeHidden();
      await expect(shell).toHaveAttribute('data-canvas-focus', 'true');

      await page.keyboard.press('f');
      await expect(shell).toHaveAttribute('data-canvas-focus', 'false');
      await page.keyboard.press('f');
      await expect(shell).toHaveAttribute('data-canvas-focus', 'true');
      await page.keyboard.press('Escape');
      await expect(shell).toHaveAttribute('data-canvas-focus', 'false');
      await expect(page.locator('.react-flow')).toBeVisible();
    });

  test('uses the real browser Fullscreen API as a second level', async ({ page }) => {
    await openDemo(page);
    await page.getByRole('button', { name: '进入画布专注模式' }).click();
    await page.getByRole('button', { name: '进入浏览器全屏' }).click();
    await expect.poll(() => page.evaluate(() =>
      document.fullscreenElement === document.documentElement))
      .toBe(true);
    await expect(page.getByRole('button', { name: '退出浏览器全屏' })).toBeVisible();
    await shotNode(page).getByRole('button', { name: /^打开 / }).click();
    await expect(page.getByRole('dialog', { name: /^媒体预览 / })).toBeVisible();
    await page.getByRole('button', { name: '关闭媒体预览' }).click();
    await page.keyboard.press('f');
    await expect.poll(() => page.evaluate(() =>
      document.fullscreenElement === document.documentElement)).toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null))
      .toBe(true);
    await expect(page.locator('.app-shell')).toHaveAttribute(
      'data-canvas-focus', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('.app-shell')).toHaveAttribute(
      'data-canvas-focus', 'false');
  });

  test('surfaces a rejected fullscreen request without trapping controls',
    async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(Element.prototype, 'requestFullscreen', {
          configurable: true,
          value: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')),
        });
      });
      await openDemo(page);
      await page.getByRole('button', { name: '进入浏览器全屏' }).click();
      await expect(page.getByRole('alert')).toContainText('浏览器拒绝进入全屏');
      await expect.poll(() => page.evaluate(() => document.fullscreenElement === null))
        .toBe(true);
      await expect(page.getByRole('button', { name: '进入浏览器全屏' }))
        .toBeEnabled();
    });

  test('locks focus transitions while a fullscreen request is pending',
    async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(Element.prototype, 'requestFullscreen', {
          configurable: true,
          value: () => new Promise<void>(() => undefined),
        });
      });
      await openDemo(page);
      await page.getByRole('button', { name: '进入浏览器全屏' }).click();
      await expect(page.getByRole('button', { name: '退出画布专注模式' }))
        .toBeDisabled();
      await expect(page.getByRole('button', { name: '进入浏览器全屏' }))
        .toBeDisabled();
      await page.keyboard.press('f');
      await expect(page.locator('.app-shell')).toHaveAttribute(
        'data-canvas-focus', 'true');
    });

  test('moves from overview to the active scene and renders media-first cards',
    async ({ page }) => {
      await openDemo(page);
      const viewport = page.locator('.react-flow__viewport');
      await page.getByRole('button', { name: 'Fit View' }).click();
      const overviewTransform = await viewport.getAttribute('style');
      const overviewZoom = await viewportZoom(viewport);

      await page.getByRole('button', { name: '聚焦当前场景' }).click();
      await expect.poll(() => viewport.getAttribute('style'))
        .not.toBe(overviewTransform);
      await expect.poll(() => viewportZoom(viewport)).toBeGreaterThan(overviewZoom);

      const scene = page.locator(
        '.react-flow__node[data-id="scene:SC-01"]');
      await expect.poll(async () => centeredDistance(scene, page.locator('.react-flow')))
        .toBeLessThan(110);
      await page.waitForTimeout(300);
      const sceneTransform = await viewport.getAttribute('style');
      await page.locator(
        `.react-flow__node[data-id="shot:${fixture.shot_ids[1]}"] h3`).click();
      await page.evaluate(() => new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      expect(await viewport.getAttribute('style')).toBe(sceneTransform);

      const shot = shotNode(page);
      await expect.poll(() => shot.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).width))).toBeGreaterThanOrEqual(300);
      await expect.poll(() => shot.locator('.canvas-card-frame').evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).height))).toBeGreaterThanOrEqual(120);
    });

  test('keeps focus controls usable in a compact application window',
    async ({ page }) => {
      await page.setViewportSize({ width: 760, height: 640 });
      await openDemo(page);
      await page.getByRole('button', { name: '进入画布专注模式' }).click();
      const canvasBox = await page.locator('.canvas-layout').boundingBox();
      expect(canvasBox?.width).toBeGreaterThanOrEqual(740);
      expect(canvasBox?.height).toBeGreaterThanOrEqual(620);
      await expect(page.getByRole('toolbar', { name: '画布视图工具' })).toBeVisible();
      await page.getByRole('button', { name: '打开资产抽屉' }).click();
      await expect.poll(async () => (await page.locator('.asset-library')
        .boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
      const drawerBox = await page.locator('.asset-library').boundingBox();
      expect(drawerBox?.x).toBeGreaterThanOrEqual(0);
      expect((drawerBox?.x ?? 0) + (drawerBox?.width ?? 0)).toBeLessThanOrEqual(760);
    });
});

async function openDemo(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(DEMO_TITLE) }).click();
  await page.getByRole('button', { name: '血缘流程', exact: true }).click();
  await expect(page.locator('.react-flow')).toBeVisible();
  await expect(shotNode(page)).toBeVisible();
}

function shotNode(page: Page) {
  return page.locator(
    `.react-flow__node[data-id="shot:${fixture.shot_ids[0]}"]`);
}

async function viewportZoom(viewport: ReturnType<Page['locator']>) {
  return viewport.evaluate((element) => {
    const match = (element as HTMLElement).style.transform
      .match(/scale\(([-\d.]+)\)/);
    return match ? Number(match[1]) : 0;
  });
}

async function centeredDistance(node: ReturnType<Page['locator']>,
  viewport: ReturnType<Page['locator']>): Promise<number> {
  const [nodeBox, viewportBox] = await Promise.all([
    node.boundingBox(), viewport.boundingBox(),
  ]);
  if (!nodeBox || !viewportBox) return Number.POSITIVE_INFINITY;
  const nodeX = nodeBox.x + nodeBox.width / 2;
  const nodeY = nodeBox.y + nodeBox.height / 2;
  const viewportX = viewportBox.x + viewportBox.width / 2;
  const viewportY = viewportBox.y + viewportBox.height / 2;
  return Math.hypot(nodeX - viewportX, nodeY - viewportY);
}
