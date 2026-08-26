import { expect, test, type Page } from '@playwright/test';

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

  test('imports, compiles, edits, approves, and restores an active plan set',
    async ({ page, request }) => {
      await openProject(page);
      await page.getByRole('button', { name: '剧本', exact: true }).click();
      await expect(page.getByRole('main', { name: '剧本工作台' })).toBeVisible();
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
      await expect(page.getByRole('button', { name: '＋ 导入新版本' }))
        .toBeVisible();
      await page.getByRole('button', { name: /V2 · 上海雨夜 V2/ }).click();
      await expect(page.getByLabel('分镜审核台')).toContainText('执行计划已批准');
      await expect(page.getByLabel('镜头 1 标题'))
        .toHaveValue('导演修订 · 雨巷重逢');
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
