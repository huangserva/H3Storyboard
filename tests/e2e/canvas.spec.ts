import Database from 'better-sqlite3';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:4187';
const projectTitle = `Canvas E2E ${crypto.randomUUID().slice(0, 8)}`;
let projectId = '';
let shotId = '';

test.describe.serial('React Flow storyboard canvas', () => {
  test.beforeAll(async ({ request }) => {
    ({ projectId, shotId } = await seedProject(request));
  });

  test('renders product controls and opens the exact node inspector', async ({ page }) => {
    await openProject(page);

    await expect(page.locator('.react-flow')).toBeVisible();
    await expect(page.locator('.react-flow__minimap')).toBeVisible();
    await expect(page.locator('.react-flow__controls')).toBeVisible();
    const shot = shotNode(page);
    await expect(shot).toBeVisible();
    await shot.click();
    const inspector = page.getByRole('complementary', { name: '节点详情' });
    await expect(inspector.getByRole('heading', { name: '雨夜相遇' })).toBeVisible();
    await expect(inspector).toContainText('最终视频只能使用 H3 原始输出中已有的声音');
  });

  test('persists a drag through HTTP and restores it after a browser reload',
    async ({ page, request }) => {
      await openProject(page);
      const shot = shotNode(page);
      await expect(shot).toBeVisible();
      const before = await canvasNode(request);

      const responsePromise = page.waitForResponse((response) =>
        response.request().method() === 'PATCH' &&
        response.url().includes('/canvas_nodes'));
      await dragBy(page, shot, 130, 70);
      expect((await responsePromise).status()).toBe(200);
      await expect.poll(() => canvasNode(request)).not.toEqual(before);
      const after = await canvasNode(request);
      expect(after.x - before.x).toBeGreaterThan(80);
      expect(after.y - before.y).toBeGreaterThan(40);

      await page.reload();
      await selectProject(page);
      await expect(shotNode(page)).toBeVisible();
      await expect.poll(async () => {
        const position = await nodeWorldPosition(shotNode(page));
        return Math.max(Math.abs(position.x - after.x),
          Math.abs(position.y - after.y));
      }).toBeLessThan(0.01);
    });

  test('shows a real persistence error and rolls the failed drag back',
    async ({ page }) => {
      await openProject(page);
      const shot = shotNode(page);
      await expect(shot).toBeVisible();
      const start = await nodeWorldPosition(shot);
      deleteCanvasNodeFromSqlite();

      const responsePromise = page.waitForResponse((response) =>
        response.request().method() === 'PATCH' &&
        response.url().includes('/canvas_nodes'));
      await dragBy(page, shot, 90, 55);
      expect((await responsePromise).status()).toBe(404);
      await expect(page.getByRole('alert')).toContainText('CANVAS_NODE_NOT_FOUND');
      await expect.poll(() => nodeWorldPosition(shot)).toEqual(start);
    });

  test('mounts a real 100-shot project with the complete minimap graph',
    async ({ page, request }) => {
      test.setTimeout(60_000);
      const largeTitle = `Canvas 100 ${crypto.randomUUID().slice(0, 8)}`;
      const projectResponse = await request.post(`${API_ORIGIN}/api/projects`, {
        data: { title: largeTitle, script_title: '百镜剧本',
          script_content: '十场百镜的真实大画布浏览器性能与可视裁剪验证。' },
      });
      const project = (await projectResponse.json()) as { data: { id: string } };
      const ordinals = Array.from({ length: 100 }, (_value, index) => index + 1);
      for (let start = 0; start < ordinals.length; start += 10) {
        await Promise.all(ordinals.slice(start, start + 10).map((ordinal) =>
          request.post(`${API_ORIGIN}/api/projects/${project.data.id}/shots`, {
            data: shotInput(ordinal),
          })));
      }

      await page.goto('/');
      await page.getByRole('button', { name: new RegExp(largeTitle) }).click();
      await expect(page.locator('.react-flow')).toBeVisible();
      await expect.poll(() => page.locator(
        '.react-flow__minimap-node').count(), { timeout: 30_000 })
        .toBeGreaterThanOrEqual(100);
      await expect(page.getByText('素材 → 分镜 → H3 JOB → TAKE / QC')).toBeVisible();
    });
});

async function seedProject(request: APIRequestContext) {
  const projectResponse = await request.post(`${API_ORIGIN}/api/projects`, { data: {
    title: projectTitle,
    script_title: '雨夜剧本',
    script_content: '上海雨夜，男女主角在霓虹与雨幕之间相遇。',
  } });
  expect(projectResponse.status()).toBe(201);
  const project = (await projectResponse.json()) as { data: { id: string } };
  const shotResponse = await request.post(
    `${API_ORIGIN}/api/projects/${project.data.id}/shots`, { data: shotInput(1) });
  expect(shotResponse.status()).toBe(201);
  const shot = (await shotResponse.json()) as { data: { id: string } };
  return { projectId: project.data.id, shotId: shot.data.id };
}

function shotInput(ordinal: number) {
  return {
    title: ordinal === 1 ? '雨夜相遇' : `计划镜头 ${ordinal}`,
    scene_id: `SC-${String(Math.ceil(ordinal / 10)).padStart(2, '0')}`,
    duration_seconds: 6, shot_size: 'medium', camera_movement: 'slow push',
    action: `镜头 ${ordinal} 的计划动作。`, dialogue: '', sound: '',
    prompt: `A cinematic storyboard shot ${ordinal}.`,
    continuity_mode: 'independent', continuity_dependencies: [],
    costume_state: {}, reference_bindings: [],
  };
}

async function openProject(page: Page): Promise<void> {
  await page.goto('/');
  await selectProject(page);
  await expect(shotNode(page)).toBeVisible();
}

async function selectProject(page: Page): Promise<void> {
  await page.getByRole('button', { name: new RegExp(projectTitle) }).click();
}

function shotNode(page: Page) {
  return page.locator(`.react-flow__node[data-id="shot:${shotId}"]`);
}

async function dragBy(page: Page, node: ReturnType<typeof shotNode>,
  deltaX: number, deltaY: number): Promise<void> {
  const box = await node.boundingBox();
  if (!box) throw new Error('shot node has no bounding box');
  const x = box.x + Math.min(70, box.width / 3);
  const y = box.y + 16;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX, y + deltaY, { steps: 8 });
  await page.mouse.up();
}

async function canvasNode(request: APIRequestContext): Promise<{
  id: string; x: number; y: number }> {
  const response = await request.get(
    `${API_ORIGIN}/api/projects/${projectId}/canvas_nodes`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { data: Array<{
    id: string; ref_id: string; x: number; y: number }> };
  const node = body.data.find(({ ref_id }) => ref_id === shotId);
  if (!node) throw new Error('persisted shot canvas node not found');
  return { id: node.id, x: node.x, y: node.y };
}

async function nodeWorldPosition(node: ReturnType<typeof shotNode>): Promise<{
  x: number; y: number }> {
  return node.evaluate((element) => {
    const transform = (element as HTMLElement).style.transform;
    const match = transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
    if (!match) throw new Error(`unexpected node transform: ${transform}`);
    return { x: Number(match[1]), y: Number(match[2]) };
  });
}

function deleteCanvasNodeFromSqlite(): void {
  const databasePath = process.env.H3_E2E_DB;
  if (!databasePath) throw new Error('H3_E2E_DB is not configured');
  const database = new Database(databasePath);
  try {
    database.prepare('DELETE FROM canvas_nodes WHERE ref_id = ?').run(shotId);
  } finally {
    database.close();
  }
}
