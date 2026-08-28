import { expect, test, type Locator, type Page } from '@playwright/test';

const API_ORIGIN = process.env.H3_E2E_API_ORIGIN ?? 'http://127.0.0.1:4187';
const title = `Script Studio ${crypto.randomUUID().slice(0, 8)}`;
let projectId = '';

test.describe.serial('P2.1 / P2.2 Script Studio and plan review', () => {
  test.beforeAll(async ({ request }) => {
    const response = await request.post(`${API_ORIGIN}/api/projects`, { data: {
      title, script_title: '上海雨夜 V1',
      script_content: '上海雨夜中，两名角色在石库门厢房里完成一段连续剧情。',
    } });
    expect(response.status()).toBe(201);
    projectId = ((await response.json()) as { data: { id: string } }).data.id;
  });

  test('guides an empty project without overlapping its canvas',
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 812 });
      await openProject(page);

      const scriptStudio = page.getByRole('main', { name: '剧本工作台' });
      await expect(scriptStudio).toBeVisible();
      await expect(page.getByLabel('剧本制作进度')).toContainText('生成 / 导入');
      await expect(page.getByRole('tab', { name: 'AI 生成剧本' }))
        .toHaveAttribute('aria-selected', 'true');
      await page.getByRole('tab', { name: '导入已有剧本' }).click();
      const importButton = page.getByRole('button', { name: '导入为草稿' });
      await expect(importButton).toBeInViewport({ ratio: 1 });
      await page.getByLabel('剧本内容').fill('SC-01 雨巷 夜\n苏晚宁：今晚别走。');
      await expect(importButton).toBeEnabled();
      expect(await importButton.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + box.width / 2, box.top + box.height / 2);
        return hit === element || element.contains(hit);
      })).toBe(true);
      await expectNoHorizontalOverflow(page);

      await page.getByRole('button', { name: '血缘流程', exact: true }).click();
      const guide = page.getByRole('region', { name: '空画布引导' });
      await expect(guide).toContainText('下一步：打开剧本工作台');
      await expect(guide).toContainText('剧本入口已就绪');
      await expect(guide).toContainText('上海雨夜 V1');
      await expect(page.locator('.react-flow__node.flow-kind-script')).toBeHidden();
      await expectNoOverlap(guide, page.locator('.flow-toolbar'));
      await expectNoOverlap(guide, page.locator('.canvas-viewport-toolbar'));
      await expectNoOverlap(guide, page.locator('.react-flow__controls'));
      await page.getByRole('button', { name: '进入画布专注模式' }).click();
      await expect(page.locator('.app-shell')).toHaveAttribute(
        'data-canvas-focus', 'true');
      await guide.getByRole('button', { name: '打开剧本工作台' }).click();
      await expect(scriptStudio).toBeVisible();
      await expect(page.locator('.app-shell')).toHaveAttribute(
        'data-canvas-focus', 'false');
      await page.getByRole('tab', { name: '导入已有剧本' }).click();

      await page.setViewportSize({ width: 1024, height: 768 });
      await expect(importButton).toBeInViewport({ ratio: 1 });
      await expectNoHorizontalOverflow(page);

      await page.setViewportSize({ width: 700, height: 900 });
      await expectNoHorizontalOverflow(page);
      await page.getByRole('button', { name: '血缘流程', exact: true }).click();
      const narrowGuide = page.getByRole('region', { name: '空画布引导' });
      await expect(narrowGuide).toBeInViewport({ ratio: 1 });
      await expect(narrowGuide.getByRole('button', {
        name: '打开剧本工作台',
      })).toBeInViewport({ ratio: 1 });
      await expect(page.getByLabel('分镜建立进度').getByRole('listitem'))
        .toHaveCount(3);
      await expectNoOverlap(narrowGuide, page.locator('.flow-toolbar'));
      await expectNoOverlap(narrowGuide, page.locator('.react-flow__controls'));
      await expectNoHorizontalOverflow(page);
    });

  test('imports, compiles, edits, approves, and restores an active plan set',
    async ({ page, request }) => {
      await openProject(page);
      await page.getByRole('button', { name: '剧本', exact: true }).click();
      await expect(page.getByRole('main', { name: '剧本工作台' })).toBeVisible();
      await page.getByRole('tab', { name: '导入已有剧本' }).click();
      await page.getByLabel('新版本标题').fill('上海雨夜 V2');
      await page.getByLabel('剧本内容').fill([
        'SC-01 雨巷 夜',
        '苏晚宁：今晚别走。',
        '顾承渊收起伞，跟着她跨过门槛。',
        'SC-02 厢房 凌晨',
        '苏晚宁点亮油灯。',
        '顾承渊：我留下。',
      ].join('\n'));
      const importResponse = page.waitForResponse((response) =>
        response.url().endsWith(`/api/projects/${projectId}/scripts/import`));
      await page.getByRole('button', { name: '导入为草稿' }).click();
      expect((await importResponse).status()).toBe(201);

      await expect(page.getByLabel('场景 SC-01')).toBeVisible();
      await expect(page.getByLabel('场景 SC-02')).toBeVisible();
      await page.getByLabel('Beat 1 服装').first().fill('苏晚宁=墨绿色旗袍');
      await page.getByLabel('Beat 1 位置').first().fill('苏晚宁=厢房门边');
      await page.getByLabel('Beat 1 道具').first().fill('油纸伞=靠在门边');
      await page.getByRole('button', { name: '保存草稿' }).click();
      await expect(page.getByRole('status')).toContainText('剧本草稿已保存');
      await page.getByRole('button', { name: '运行校验' }).click();
      await expect(page.getByLabel('剧本校验结果')).toContainText('校验通过');
      await page.getByRole('button', { name: '锁定剧本' }).click();
      await expect(page.getByRole('button', { name: '编译草稿分镜' }))
        .toBeVisible();

      const compileResponse = page.waitForResponse((response) =>
        response.url().endsWith('/compile') && response.request().method() === 'POST');
      await page.getByRole('button', { name: '编译草稿分镜' }).click();
      expect((await compileResponse).status()).toBe(201);
      await expect(page.getByLabel('分镜审核台')).toBeVisible();
      await page.reload();
      await selectProject(page);
      await expect(page.getByRole('main', { name: '剧本工作台' })).toBeVisible();
      await expect(page.getByLabel('分镜审核台')).toBeVisible();
      await expect(page.getByLabel('审核镜头 1')).toContainText('苏晚宁：今晚别走。');
      await page.getByLabel('镜头 1 标题').fill('导演修订 · 雨巷重逢');
      await page.getByLabel('镜头 1 动作').fill('苏晚宁停在檐下，顾承渊收伞走近。');
      await page.getByLabel('镜头 2 标题').fill('导演修订 · 厢房留灯');
      await expect(page.getByRole('button', { name: '批准整套分镜' }))
        .toBeDisabled();
      const editResponse = page.waitForResponse((response) =>
        response.url().includes('/plan_review/shots/') &&
        response.request().method() === 'PATCH');
      await page.getByRole('button', { name: '保存镜头 1修改' }).click();
      expect((await editResponse).status()).toBe(200);
      await expect(page.locator('.script-message')).toContainText('导演修改已保存');
      await expect(page.getByLabel('镜头 2 标题'))
        .toHaveValue('导演修订 · 厢房留灯');
      await expect(page.getByRole('button', { name: '批准整套分镜' }))
        .toBeDisabled();
      const secondEditResponse = page.waitForResponse((response) =>
        response.url().includes('/plan_review/shots/') &&
        response.request().method() === 'PATCH');
      await page.getByRole('button', { name: '保存镜头 2修改' }).click();
      expect((await secondEditResponse).status()).toBe(200);
      await expect(page.getByRole('button', { name: '批准整套分镜' }))
        .toBeEnabled();

      const approveResponse = page.waitForResponse((response) =>
        response.url().endsWith('/plan_review/approve') &&
        response.request().method() === 'POST');
      await page.getByRole('button', { name: '批准整套分镜' }).click();
      expect((await approveResponse).status()).toBe(200);
      await expect(page.getByLabel('分镜审核台')).toContainText('ACTIVE PLAN SET');
      await page.getByRole('button', { name: '查看画布' }).click();
      await expect(page.locator('.react-flow')).toBeVisible();
      await page.getByRole('button', { name: 'Fit View' }).click();
      await expect(page.locator('.canvas-shot-card')).toHaveCount(2);
      await expect(page.locator('.canvas-shot-card').first()).toContainText('APPROVED');

      const snapshot = (await (await request.get(
        `${API_ORIGIN}/api/projects/${projectId}`)).json()) as { data: {
          project: { active_script_compilation_id: string | null };
          shot_plans: Array<{ planning_status: string; sound: string;
            source_script_scene_id: string | null;
            source_script_beat_ids: string[] }>;
          h3_jobs: unknown[];
        } };
      expect(snapshot.data.shot_plans).toHaveLength(2);
      expect(snapshot.data.shot_plans.every((shot) =>
        shot.planning_status === 'approved' && shot.sound === '' &&
        shot.source_script_scene_id !== null &&
        shot.source_script_beat_ids.length > 0)).toBe(true);
      expect(snapshot.data.h3_jobs).toHaveLength(0);
      expect(snapshot.data.project.active_script_compilation_id).not.toBeNull();

      await page.reload();
      await selectProject(page);
      await page.getByRole('button', { name: '剧本', exact: true }).click();
      await page.getByRole('button', { name: /V1 · 上海雨夜 V1/ }).click();
      await expect(page.getByRole('button', { name: '＋ 新建剧本版本' }))
        .toBeVisible();
      await expect(page.locator('.script-archive-notice'))
        .toContainText('这是历史剧本版本');
      await page.getByRole('button', { name: /V2 · 上海雨夜 V2/ }).click();
      await expect(page.getByLabel('分镜审核台')).toContainText('执行计划已批准');
      await expect(page.getByLabel('镜头 1 标题'))
        .toHaveValue('导演修订 · 雨巷重逢');

      await page.setViewportSize({ width: 1024, height: 768 });
      await expect(page.getByRole('button', { name: '＋ 新建剧本版本' }))
        .toBeInViewport({ ratio: 1 });
      await page.getByRole('button', { name: '＋ 新建剧本版本' }).click();
      await page.getByRole('tab', { name: '导入已有剧本' }).click();
      await page.getByLabel('新版本标题').fill('上海雨夜 V3 草稿');
      await page.getByLabel('剧本内容').fill(
        'SC-01 雨巷 夜\n苏晚宁停在雨里，重新考虑下一步。');
      await page.getByRole('button', { name: '导入为草稿' }).click();
      await expect(page.getByRole('button', { name: /V3 · 上海雨夜 V3 草稿/ }))
        .toBeVisible();
      await page.reload();
      await selectProject(page);
      await expect(page.getByRole('main', { name: '剧本工作台' })).toBeVisible();
      await expect(page.getByRole('button', { name: /V3 · 上海雨夜 V3 草稿/ }))
        .toBeVisible();
      await expect(page.getByRole('button', { name: '继续剧本流程' }))
        .toBeVisible();
      await page.getByRole('button', { name: '运行校验' }).click();
      await expect(page.getByLabel('剧本校验结果')).toContainText('校验通过');
      await page.getByRole('button', { name: '锁定剧本' }).click();
      await expect(page.getByRole('button', { name: '编译草稿分镜' }))
        .toBeVisible();

      await page.reload();
      await selectProject(page);
      await expect(page.getByRole('main', { name: '剧本工作台' })).toBeVisible();
      await expect(page.getByRole('button', { name: '编译草稿分镜' }))
        .toBeVisible();
      await expect(page.getByRole('button', { name: '继续剧本流程' }))
        .toBeVisible();
      await page.getByRole('button', { name: /V2 · 上海雨夜 V2/ }).click();
      await expect(page.getByLabel('分镜审核台')).toContainText('ACTIVE PLAN SET');
      await expect(page.locator('.script-archive-notice'))
        .toContainText('分镜仍是当前执行计划');
      await page.getByRole('button', { name: /V3 · 上海雨夜 V3 草稿/ }).click();
      await page.getByRole('button', { name: '编译草稿分镜' }).click();
      await expect(page.getByLabel('分镜审核台')).toBeVisible();
      await expect(page.getByRole('button', { name: '批准整套分镜' }))
        .toBeEnabled();
      await page.getByRole('button', { name: '批准整套分镜' }).click();
      await expect(page.getByLabel('分镜审核台')).toContainText('ACTIVE PLAN SET');

      await page.reload();
      await selectProject(page);
      await expect(page.getByRole('button', { name: '制片墙', exact: true }))
        .toHaveAttribute('data-active', 'true');
      await expect(page.getByRole('button', { name: '＋ 新增计划镜头' }))
        .toBeVisible();
    });

  test('keeps a superseded unapproved review read only', async ({ page }) => {
    await openProject(page);
    await page.getByRole('button', { name: '剧本', exact: true }).click();
    await page.getByRole('button', { name: '＋ 新建剧本版本' }).click();
    await page.getByRole('tab', { name: '导入已有剧本' }).click();
    await page.getByLabel('新版本标题').fill('上海雨夜 V4 未批准');
    await page.getByLabel('剧本内容').fill(
      'SC-01 石库门 夜\n苏晚宁推开门，停在灯下。');
    await page.getByRole('button', { name: '导入为草稿' }).click();
    await page.getByRole('button', { name: '运行校验' }).click();
    await expect(page.getByLabel('剧本校验结果')).toContainText('校验通过');
    await page.getByRole('button', { name: '锁定剧本' }).click();
    await page.getByRole('button', { name: '编译草稿分镜' }).click();
    await expect(page.getByRole('button', { name: '批准整套分镜' }))
      .toBeEnabled();

    await page.getByRole('button', { name: '＋ 新建剧本版本' }).click();
    await page.getByRole('tab', { name: '导入已有剧本' }).click();
    await page.getByLabel('新版本标题').fill('上海雨夜 V5 接替版');
    await page.getByLabel('剧本内容').fill(
      'SC-01 石库门 夜\n顾承渊走进门，收起雨伞。');
    await page.getByRole('button', { name: '导入为草稿' }).click();
    await page.getByRole('button', { name: '运行校验' }).click();
    await expect(page.getByLabel('剧本校验结果')).toContainText('校验通过');
    await page.getByRole('button', { name: '锁定剧本' }).click();

    await page.getByRole('button', { name: /V4 · 上海雨夜 V4 未批准/ }).click();
    await expect(page.locator('.script-archive-notice'))
      .toContainText('该版本已归档，仅供查看');
    await expect(page.getByRole('button', { name: '批准整套分镜' }))
      .toBeHidden();
    await expect(page.locator('.plan-review-shot input').first()).toBeDisabled();
    await expect(page.locator('.script-progress li[data-state="skipped"]'))
      .toHaveCount(1);

    await page.getByRole('button', { name: /V5 · 上海雨夜 V5 接替版/ }).click();
    await page.getByRole('button', { name: '编译草稿分镜' }).click();
    await expect(page.getByRole('button', { name: '批准整套分镜' }))
      .toBeEnabled();
    await page.getByRole('button', { name: '批准整套分镜' }).click();
    await expect(page.getByLabel('分镜审核台')).toContainText('ACTIVE PLAN SET');
    await page.reload();
    await selectProject(page);
    await expect(page.getByRole('button', { name: '制片墙', exact: true }))
      .toHaveAttribute('data-active', 'true');
  });
});

async function openProject(page: Page) {
  await page.goto('/');
  await selectProject(page);
}

async function selectProject(page: Page) {
  await page.getByRole('button', { name: new RegExp(title) }).click();
  await expect(page.locator('.workbench')).toBeVisible();
}

async function expectNoOverlap(left: Locator, right: Locator) {
  const [leftBox, rightBox] = await Promise.all([
    left.boundingBox(), right.boundingBox(),
  ]);
  expect(leftBox).not.toBeNull();
  expect(rightBox).not.toBeNull();
  expect(leftBox!.x < rightBox!.x + rightBox!.width &&
    leftBox!.x + leftBox!.width > rightBox!.x &&
    leftBox!.y < rightBox!.y + rightBox!.height &&
    leftBox!.y + leftBox!.height > rightBox!.y).toBe(false);
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
