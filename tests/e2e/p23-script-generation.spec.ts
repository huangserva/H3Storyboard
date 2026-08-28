import { expect, test } from '@playwright/test';

const API_ORIGIN = process.env.H3_E2E_API_ORIGIN ?? 'http://127.0.0.1:4187';

test('generates an AI draft from a creator brief without starting production',
  async ({ page, request }) => {
    const title = `P2.3 AI Script ${crypto.randomUUID().slice(0, 8)}`;
    const created = await request.post(`${API_ORIGIN}/api/projects`, { data: {
      title,
      script_title: '人工初始版本',
      script_content: '这是已经锁定的人工初始剧本，AI 生成不得覆盖或自动替换。',
    } });
    expect(created.status()).toBe(201);
    const projectId = ((await created.json()) as { data: { id: string } }).data.id;

    await page.goto('/');
    await page.getByRole('button', { name: new RegExp(title) }).click();
    await expect(page.getByRole('main', { name: '剧本工作台' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'AI 生成剧本' }))
      .toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.script-generation-status'))
      .toContainText('playwright-provider · playwright-screenwriter');

    await page.getByLabel('AI 剧本标题').fill('上海雨夜 · AI 草稿');
    await page.getByLabel('故事创意或原文').fill(
      '一对旧情人在上海雨夜重逢，女方决定结束长期逃避，男方必须在天亮前作出选择。',
    );
    await page.getByLabel('剧本题材').fill('民国爱情悬疑');
    await page.getByLabel('目标时长（秒）').fill('15');
    await page.getByLabel('目标场景数').fill('2');
    await page.getByLabel('主要人物').fill(
      '苏晚宁：克制但主动\n顾承渊：寡言，习惯回避',
    );

    const generation = page.waitForResponse((response) =>
      response.url().endsWith(`/api/projects/${projectId}/scripts/generation`) &&
      response.request().method() === 'POST');
    await page.getByRole('button', { name: '生成 AI 草稿' }).click();
    expect((await generation).status()).toBe(201);

    await expect(page.getByLabel('场景 E01-S01')).toBeVisible();
    await expect(page.getByLabel('场景 E01-S02')).toBeVisible();
    await expect(page.getByLabel('剧本校验结果')).toContainText('校验通过');
    await expect(page.getByLabel('AI 剧本独立审阅'))
      .toContainText('approve_with_notes');
    await expect(page.getByLabel('AI 剧本独立审阅'))
      .toContainText('后续可人工微调节奏');
    await expect(page.getByRole('button', { name: /V2 · 上海雨夜 · AI 草稿/ }))
      .toContainText('AI · playwright-provider / playwright-screenwriter');
    await expect(page.getByRole('button', { name: '锁定剧本' })).toBeVisible();
    await page.getByRole('button', { name: '保存草稿' }).click();
    await expect(page.getByLabel('AI 剧本独立审阅'))
      .toContainText('当前草稿已修改');

    const snapshot = (await (await request.get(
      `${API_ORIGIN}/api/projects/${projectId}`)).json()) as { data: {
        project: { active_script_version_id: string };
        script_version: { id: string };
        h3_jobs: unknown[];
      } };
    expect(snapshot.data.script_version.id)
      .toBe(snapshot.data.project.active_script_version_id);
    expect(snapshot.data.h3_jobs).toHaveLength(0);
  });
