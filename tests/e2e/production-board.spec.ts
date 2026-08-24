import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ProjectStore } from '../../packages/project-store/src/index.js';

const API_ORIGIN = process.env.H3_E2E_API_ORIGIN ?? 'http://127.0.0.1:4187';
const title = `Production Board ${crypto.randomUUID().slice(0, 8)}`;
let projectId = '';
let characterId = '';

test.describe.serial('P1.3 production board', () => {
  test.beforeAll(async ({ request }) => {
    const project = await request.post(`${API_ORIGIN}/api/projects`, { data: {
      title, script_title: '制片墙测试剧本',
      script_content: '上海雨夜里，两位角色在同一场景完成三段连续计划镜头。',
    } });
    projectId = ((await project.json()) as { data: { id: string } }).data.id;
    const character = await request.post(
      `${API_ORIGIN}/api/projects/${projectId}/characters`, { data: {
        name: '苏婉宁', canonical_appearance:
          'Chinese woman, late twenties, low black hair bun, emerald qipao.',
        seed_family: [1241, 4241], status: 'approved',
      } });
    characterId = ((await character.json()) as { data: { id: string } }).data.id;
    for (const ordinal of [1, 2, 3]) await request.post(
      `${API_ORIGIN}/api/projects/${projectId}/shots`, { data: {
        title: `雨夜镜头 ${ordinal}`, scene_id: 'SC-01', duration_seconds: 6,
        shot_size: '中景', camera_movement: 'slow push',
        action: `苏婉宁完成第 ${ordinal} 个计划动作。`, dialogue: '', sound: '',
        prompt: `cinematic Shanghai rain shot ${ordinal}`,
        continuity_mode: 'independent', continuity_dependencies: [],
        costume_state: { 苏婉宁: '墨绿色旗袍' }, reference_bindings: [],
        semantic_references: [{ purpose: 'reference_character',
          target: { type: 'character', character_id: characterId } }],
      } });
  });

  test('uses the dense board by default and preserves Plan / Take separation',
    async ({ page }) => {
      await openProject(page);
      await expect(page.getByRole('main', { name: '制片墙' })).toBeVisible();
      await expect(page.getByRole('heading', { name: '角色圣经' })).toBeVisible();
      await expect(page.getByRole('article', { name: '角色卡 苏婉宁' })).toBeVisible();
      await expect(page.locator('.production-shot-wall .production-shot-card'))
        .toHaveCount(3);
      const firstShot = page.locator('.production-shot-card').first();
      await expect(firstShot).toContainText('PLAN');
      await expect(firstShot).toContainText('LATEST TAKE');
      await expect(firstShot).toContainText('NO TAKE');
      await expect(page.locator('.production-shot-wall')).toHaveCSS(
        'grid-template-columns', /.+ .+ .+/);
      await page.getByRole('button', { name: '血缘流程' }).click();
      await expect(page.locator('.react-flow')).toBeVisible();
      await page.getByRole('button', { name: '制片墙' }).click();
      await expect(page.getByRole('main', { name: '制片墙' })).toBeVisible();
    });

  test('uploads master and angle candidates, approves both, and restores lineage',
    async ({ page, request }) => {
      await openProject(page);
      const card = page.getByRole('article', { name: '角色卡 苏婉宁' });
      const uploadResponse = page.waitForResponse((response) =>
        response.url().includes('/reference_uploads') &&
        response.request().method() === 'POST');
      await card.locator('input[type="file"]').first().setInputFiles({
        name: 'suwanning-master.png', mimeType: 'image/png', buffer: PNG_1X1,
      });
      const masterHttpResponse = await uploadResponse;
      expect(masterHttpResponse.status()).toBe(201);
      const masterBody = (await masterHttpResponse.json()) as { data: {
        asset: { id: string }; reference: { id: string };
      } };
      await expect(card).toContainText('MASTER · candidate');
      const approveResponse = page.waitForResponse((response) =>
        response.url().endsWith('/approve') && response.request().method() === 'POST');
      await card.getByRole('button', { name: '批准' }).click();
      expect((await approveResponse).status()).toBe(200);
      await expect(card.getByRole('img', { name: '苏婉宁 approved 母图' })).toBeVisible();
      await expect(page.getByRole('status')).toContainText('manifest_stale = false');
      const firstFreeze = page.waitForResponse((response) =>
        response.url().endsWith(`/api/projects/${projectId}/manifests`) &&
        response.request().method() === 'POST');
      await page.getByRole('button', { name: '冻结 CURRENT-ASSETS' }).click();
      expect((await firstFreeze).status()).toBe(201);
      await expect(page.getByRole('status')).toBeHidden();

      const angleUploadResponse = page.waitForResponse((response) =>
        response.url().includes('/reference_uploads') &&
        response.request().headers()['x-derived-from-reference-id'] !== undefined);
      await card.locator('input[type="file"]').nth(1).setInputFiles({
        name: 'suwanning-profile.png', mimeType: 'image/png', buffer: PNG_1X1,
      });
      const angleHttpResponse = await angleUploadResponse;
      expect(angleHttpResponse.status()).toBe(201);
      const angleBody = (await angleHttpResponse.json()) as { data: {
        asset: { id: string }; reference: { id: string };
        asset_derivation: { source_asset_id: string; kind: string };
      } };
      expect(angleBody.data.asset_derivation).toMatchObject({
        kind: 'character_angle_upload',
      });
      await expect(card).toContainText('DERIVED · candidate');
      const angleApproveResponse = page.waitForResponse((response) =>
        response.url().includes(`/references/${angleBody.data.reference.id}/approve`));
      await card.getByRole('button', {
        name: '批准 苏婉宁 suwanning-profile.png',
      }).click();
      expect((await angleApproveResponse).status()).toBe(200);
      await expect(card).toContainText('DERIVED · approved');
      await expect(page.getByRole('status')).toContainText('manifest_stale = true');

      const repeatedApproval = await request.post(
        `${API_ORIGIN}/api/projects/${projectId}/characters/${characterId}` +
        `/references/${angleBody.data.reference.id}/approve`, {
          data: { make_primary: false },
        });
      expect(repeatedApproval.status()).toBe(200);
      const catalog = await request.get(
        `${API_ORIGIN}/api/projects/${projectId}/character_catalog`);
      const catalogBody = (await catalog.json()) as { data: {
        references: Array<{ id: string; sort_order: number }>;
        asset_derivations: Array<{ asset_id: string; source_asset_id: string }>;
      } };
      expect(catalogBody.data.references).toHaveLength(2);
      expect(catalogBody.data.references.map(({ id, sort_order }) => ({
        id, sort_order,
      }))).toEqual([
        { id: masterBody.data.reference.id, sort_order: 0 },
        { id: angleBody.data.reference.id, sort_order: 1 },
      ]);
      expect(catalogBody.data.asset_derivations).toContainEqual(expect.objectContaining({
        asset_id: angleBody.data.asset.id,
        source_asset_id: angleBody.data.asset_derivation.source_asset_id,
      }));

      await page.reload();
      await selectProject(page);
      const reloadedCard = page.getByRole('article', { name: '角色卡 苏婉宁' });
      await expect(reloadedCard.getByRole('img', {
        name: '苏婉宁 approved 母图',
      })).toBeVisible();
      await expect(reloadedCard).toContainText('DERIVED · approved');
      await page.getByRole('button', { name: '血缘流程' }).click();
      await page.getByRole('button', { name: 'Fit View' }).click();
      await expect(page.getByRole('group', { name:
        `Edge from asset:${masterBody.data.asset.id} to asset:${angleBody.data.asset.id}`,
      })).toBeAttached();
      const characterNode = page.locator(
        `.react-flow__node[data-id="character:${characterId}"]`);
      await expect(characterNode.getByRole('img', {
        name: '苏婉宁 approved reference',
      })).toBeVisible();
      await characterNode.click();
      await expect(page.getByRole('complementary', { name: '节点详情' })
        .getByRole('img', { name: 'suwanning-master.png' })).toBeVisible();
    });

  test('keeps project JSON requests bounded and avoids page-level overflow',
    async ({ page }) => {
      const calls: string[] = [];
      page.on('request', (request) => {
        if (request.resourceType() === 'fetch' && request.url().includes('/api/projects/')) {
          calls.push(new URL(request.url()).pathname);
        }
      });
      await openProject(page);
      const projectCalls = calls.filter((path) => path.includes(projectId));
      expect(projectCalls).toHaveLength(4);
      expect(new Set(projectCalls)).toEqual(new Set([
        `/api/projects/${projectId}`,
        `/api/projects/${projectId}/character_catalog`,
        `/api/projects/${projectId}/character_image_jobs`,
        `/api/projects/${projectId}/jobs/preflights`,
      ]));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <=
        document.documentElement.clientWidth)).toBe(true);
    });

  test('creates, cancels, retries, and restores a real local image job',
    async ({ page }) => {
      await openProject(page);
      const card = page.getByRole('article', { name: '角色卡 苏婉宁' });
      await card.getByRole('button', { name: '生成派生图' }).click();
      const dialog = page.getByRole('dialog', { name: '苏婉宁 角色图生成' });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('LORA 无（不会默认加载）');
      await dialog.getByLabel('生成方式').selectOption('variant_i2i');
      await expect(dialog.getByLabel('Denoise')).toHaveValue('0.52');

      const createResponse = page.waitForResponse((response) =>
        response.url().endsWith(`/characters/${characterId}/image_jobs`) &&
        response.request().method() === 'POST');
      await dialog.getByRole('button', { name: '提交角色图任务' }).click();
      const createdHttp = await createResponse;
      expect(createdHttp.status()).toBe(201);
      const createBody = createdHttp.request().postDataJSON() as Record<string, unknown>;
      expect(createBody).toMatchObject({ operation: 'variant_i2i', denoise: 0.52,
        lora_profile: null, lora_name: null, lora_strength: null });
      expect(createBody).not.toHaveProperty('engine');
      expect(createBody).not.toHaveProperty('provider');
      expect(createBody.source_reference_ids).toHaveLength(1);
      const created = (await createdHttp.json()) as { data: { id: string } };
      await expect(card.locator('.character-image-job').first()).toContainText('draft');

      const cancelResponse = page.waitForResponse((response) =>
        response.url().endsWith(`/character_image_jobs/${created.data.id}/cancel`));
      await card.getByRole('button', {
        name: `取消角色图任务 ${created.data.id}`,
      }).click();
      expect((await cancelResponse).status()).toBe(200);
      await expect(card.locator('.character-image-job').first()).toContainText('canceled');

      const retryResponse = page.waitForResponse((response) =>
        response.url().endsWith(`/character_image_jobs/${created.data.id}/retry`));
      await card.getByRole('button', {
        name: `重试角色图任务 ${created.data.id}`,
      }).click();
      const retriedHttp = await retryResponse;
      expect(retriedHttp.status()).toBe(201);
      const retried = (await retriedHttp.json()) as { data: { id: string } };
      await expect(card.locator('.character-image-job').first()).toContainText('draft');

      const retryCancel = page.waitForResponse((response) =>
        response.url().endsWith(`/character_image_jobs/${retried.data.id}/cancel`));
      await card.getByRole('button', {
        name: `取消角色图任务 ${retried.data.id}`,
      }).click();
      expect((await retryCancel).status()).toBe(200);
      await page.reload();
      await selectProject(page);
      await expect(page.getByRole('article', { name: '角色卡 苏婉宁' })
        .locator('.character-image-job').first()).toContainText('canceled');
    });

  test('restores a completed worker result as a candidate before manual approval',
    async ({ page }) => {
      const databasePath = process.env.H3_E2E_DB;
      if (!databasePath) throw new Error('H3_E2E_DB is required');
      const dataDirectory = dirname(databasePath);
      const outputName = 'suwanning-generated-e2e.png';
      const outputPath = `assets/characters/${projectId}/generated/${outputName}`;
      mkdirSync(dirname(join(dataDirectory, outputPath)), { recursive: true });
      writeFileSync(join(dataDirectory, outputPath), PNG_1X1);
      const store = new ProjectStore(databasePath);
      let outputAssetId = '';
      try {
        const draft = store.characterImageJobs.create(projectId, characterId, {
          operation: 'master_t2i', provider: 'local_comfyui', engine: 'krea2',
          prompt: 'E2E worker-generated neutral master portrait.',
          seed: 2026082499, width: 480, height: 864, steps: 8, cfg: 1,
          sampler: 'euler_ancestral', scheduler: 'sgm_uniform', denoise: null,
          lora_profile: null, lora_name: null, lora_strength: null,
          source_reference_ids: [], idempotency_key:
            'production-board-completed-image-e2e',
        });
        const claimed = store.characterImageJobs.claim(draft.id, 120_000);
        store.characterImageJobs.markSubmitIntent(
          draft.id, claimed.lease_token!, 'e2e-comfy-client',
        );
        store.characterImageJobs.markQueued(
          draft.id, claimed.lease_token!, 'e2e-comfy-prompt',
        );
        store.characterImageJobs.markRunning(draft.id, claimed.lease_token!);
        const result = store.characterImageJobs.finalizeOutput(
          draft.id,
          claimed.lease_token!,
          { name: outputName, relative_path: outputPath,
            content_hash: `sha256:${createHash('sha256').update(PNG_1X1)
              .digest('hex')}` },
        );
        outputAssetId = result.asset.id;
        expect(result.asset.status).toBe('candidate');
        store.freezeCurrentAssetsManifest(projectId);
      } finally {
        store.close();
      }

      await openProject(page);
      await page.reload();
      await selectProject(page);
      const card = page.getByRole('article', { name: '角色卡 苏婉宁' });
      const completed = card.locator('.character-image-job').filter({
        hasText: 'SEED 2026082499',
      });
      await expect(completed).toHaveCount(1);
      await expect(completed).toContainText('completed');
      await expect(completed).toContainText('候选已生成 · 等待人工批准');
      const candidate = card.locator('.production-reference-thumb').filter({
        has: page.locator(`img[src*="${outputAssetId}"]`),
      });
      await expect(candidate).toContainText('MASTER · candidate');
      await expect(candidate.locator('img')).toBeVisible();
      await expect.poll(() => candidate.locator('img').evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      )).toBe(true);
      await expect(page.getByRole('status')).toBeHidden();

      const approval = page.waitForResponse((response) =>
        response.url().includes('/references/') &&
        response.url().endsWith('/approve') &&
        response.request().method() === 'POST');
      await card.getByRole('button', {
        name: `批准 苏婉宁 ${outputName}`,
      }).click();
      expect((await approval).status()).toBe(200);
      await expect(candidate).toContainText('MASTER · approved');
      await expect(page.getByRole('status')).toContainText('manifest_stale = true');

      await page.reload();
      await selectProject(page);
      const restoredCard = page.getByRole('article', { name: '角色卡 苏婉宁' });
      await expect(restoredCard.locator('.character-image-job').filter({
        hasText: 'SEED 2026082499',
      })).toContainText('completed');
      await expect(restoredCard.getByRole('button', {
        name: `归档 苏婉宁 ${outputName}`,
      })).toBeVisible();
      expect(outputAssetId).not.toBe('');
    });

  test('keeps the board keyboard-reachable without mobile page overflow',
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openProject(page);
      await page.getByRole('button', { name: /02 雨夜镜头 2/ }).click();
      await expect(page.locator('.production-shot-card').nth(1))
        .toHaveAttribute('data-selected', 'true');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <=
        document.documentElement.clientWidth)).toBe(true);
      expect(await tabUntil(page, (label) => label.includes('上传母图')))
        .toContain('上传母图');
      const archiveLabel = await tabUntil(page, (label) =>
        label.includes('归档 苏婉宁 suwanning-master.png'));
      expect(archiveLabel).toContain('suwanning-master.png');
      const archiveResponse = page.waitForResponse((response) =>
        response.request().method() === 'PATCH' &&
        response.url().endsWith(`/api/projects/${projectId}/assets`));
      await page.keyboard.press('Enter');
      expect((await archiveResponse).status()).toBe(200);
      await expect(page.getByRole('article', { name: '角色卡 苏婉宁' }))
        .toContainText('MASTER · archived');
      const shotLabel = await tabUntil(page, (label) =>
        label.includes('SHOT 01') && label.includes('雨夜镜头 1'));
      expect(shotLabel).toContain('雨夜镜头 1');
      await expect(page.locator('.production-shot-select').first()).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('.production-shot-card').first())
        .toHaveAttribute('data-selected', 'true');
    });
});

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function openProject(page: Page) {
  await page.goto('/');
  await selectProject(page);
}

async function selectProject(page: Page) {
  await page.getByRole('button', { name: new RegExp(title) }).click();
  await expect(page.getByRole('main', { name: '制片墙' })).toBeVisible();
}

async function tabUntil(page: Page, matches: (label: string) => boolean) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const visited: string[] = [];
  for (let index = 0; index < 80; index += 1) {
    await page.keyboard.press('Tab');
    const label = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return '';
      const labelled = 'labels' in active
        ? (active as HTMLInputElement).labels?.[0]?.textContent ?? '' : '';
      return active.getAttribute('aria-label') || labelled || active.textContent || '';
    });
    visited.push(label.trim());
    if (matches(label.trim())) return label.trim();
  }
  throw new Error(`Keyboard traversal did not reach the expected control: ${
    JSON.stringify([...new Set(visited)])}`);
}
