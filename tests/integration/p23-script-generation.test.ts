import {
  createServer,
  request as httpRequest,
  type Server,
  type ServerResponse,
} from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Agent,
  getGlobalDispatcher,
  setGlobalDispatcher,
} from 'undici';
import {
  ScriptGenerationCapabilitySchema,
  ScriptGenerationResultSchema,
} from '@h3storyboard/protocol';
import {
  createApiServer,
  type ApiServer,
} from '../../apps/api/src/index.js';
import { ScriptGenerationConfigError } from
  '../../apps/api/src/script-generation-provider.js';

const apiServers = new Set<ApiServer>();
const providerServers = new Set<Server>();
const directories = new Set<string>();

afterEach(async () => {
  await Promise.all([...apiServers].map((server) => server.close()));
  await Promise.all([...providerServers].map((server) => closeServer(server)));
  await Promise.all([...directories].map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
  apiServers.clear();
  providerServers.clear();
  directories.clear();
});

describe('P2.3 AI script generation', () => {
  it('reports an unavailable capability and rejects generation without config',
    async () => {
      const api = await startApi();
      const projectId = await createProject(api.origin, '未配置生成器');

      const capabilityResponse = await fetch(
        `${api.origin}/api/projects/${projectId}/scripts/generation`,
      );
      expect(capabilityResponse.status).toBe(200);
      expect(ScriptGenerationCapabilitySchema.parse(
        data(await capabilityResponse.json()),
      )).toEqual({
        available: false,
        strategy: 'shuohao_v1',
        provider: null,
        model: null,
      });

      const generationResponse = await post(
        `${api.origin}/api/projects/${projectId}/scripts/generation`,
        generationInput(),
      );
      await expectError(generationResponse, 503, 'SCRIPT_GENERATION_UNAVAILABLE');
    });

  it('crosses real provider HTTP and SQLite to persist an editable AI draft',
    async () => {
      const receivedRequests: unknown[] = [];
      const provider = await startProvider(async (body) => {
        receivedRequests.push(body);
        return { choices: [{ message: { content: JSON.stringify(
          shuohaoGeneratedScript(),
        ) } }] };
      });
      const api = await startApi({
        endpoint: provider.origin,
        api_key: 'integration-key',
        model: 'screenwriter-test',
        provider: 'local-test-provider',
        timeout_ms: 2_000,
      });
      const projectId = await createProject(api.origin, 'AI 雨夜');

      const generationResponse = await post(
        `${api.origin}/api/projects/${projectId}/scripts/generation`,
        generationInput(),
      );
      expect(generationResponse.status).toBe(201);
      const result = ScriptGenerationResultSchema.parse(
        data(await generationResponse.json()),
      );
      expect(result.document.version).toMatchObject({
        project_id: projectId,
        status: 'draft',
        source_format: 'shuohao_novel_script',
        generation_provider: 'local-test-provider',
        generation_model: 'screenwriter-test',
        generation_review: {
          verdict: 'approve',
          review_method: 'fresh_context',
          reviewed_revision: 0,
        },
        generation_input: generationInput(),
      });
      expect(result.document.scenes).toHaveLength(2);
      expect(result.document.scenes[0]).toMatchObject({
        scene_key: 'E01-S01',
        location: '石库门雨巷',
        time_of_day: '夜',
      });
      expect(result.document.scenes[0]?.beats[1]).toMatchObject({
        kind: 'dialogue',
        speaker: '苏晚宁',
        text: '今晚别走。',
      });
      expect(result.validation.valid).toBe(true);
      expect(result.validation.statistics.estimated_duration_seconds)
        .toBeGreaterThanOrEqual(12.75);
      expect(result.validation.statistics.estimated_duration_seconds)
        .toBeLessThanOrEqual(17.25);
      expect(result.generation).toMatchObject({
        strategy: 'shuohao_v1',
        provider: 'local-test-provider',
        model: 'screenwriter-test',
        attempt_count: 1,
        review: {
          verdict: 'approve',
          provider: 'local-test-provider',
          model: 'screenwriter-test',
          review_method: 'fresh_context',
          reviewed_revision: 0,
        },
      });
      expect(receivedRequests).toHaveLength(1);
      expect(receivedRequests[0]).toMatchObject({
        model: 'screenwriter-test',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system' },
          { role: 'user' },
        ],
      });

      const snapshotResponse = await fetch(
        `${api.origin}/api/projects/${projectId}`,
      );
      const snapshot = data<{ project: { active_script_version_id: string };
        script_version: { id: string }; h3_jobs: unknown[] }>(
        await snapshotResponse.json(),
      );
      expect(snapshot.script_version.id).toBe(
        snapshot.project.active_script_version_id,
      );
      expect(snapshot.script_version.id).not.toBe(result.document.version.id);
      expect(snapshot.h3_jobs).toHaveLength(0);

      await api.server.close();
      apiServers.delete(api.server);
      const restarted = await startApi({
        endpoint: provider.origin,
        model: 'screenwriter-test',
        provider: 'local-test-provider',
      }, api.databasePath);
      const versionsResponse = await fetch(
        `${restarted.origin}/api/projects/${projectId}/scripts`,
      );
      expect(data<Array<{ generation_provider: string | null }>>(
        await versionsResponse.json(),
      )[0]?.generation_provider).toBe('local-test-provider');
    });

  it('does not inherit the global fetch response-header deadline', async () => {
    const provider = await startRawProvider(async (body, response) => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      const payload = providerUserMessage(body).includes('请独立审阅')
        ? approvedReview()
        : { choices: [{ message: { content: JSON.stringify(
          shuohaoGeneratedScript(),
        ) } }] };
      const json = JSON.stringify(payload);
      if (response.destroyed) return;
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(json),
      }).end(json);
    });
    const api = await startApi({
      endpoint: provider.origin,
      model: 'slow-header-model',
      timeout_ms: 500,
    });
    const projectId = await createProject(api.origin, '慢响应头回归');
    const originalDispatcher = getGlobalDispatcher();
    const shortHeaderDispatcher = new Agent({ headersTimeout: 20 });
    setGlobalDispatcher(shortHeaderDispatcher);
    try {
      const response = await postWithNodeHttp(
        `${api.origin}/api/projects/${projectId}/scripts/generation`,
        generationInput(),
      );
      expect(response.status).toBe(201);
    } finally {
      setGlobalDispatcher(originalDispatcher);
      await shortHeaderDispatcher.close();
    }
    expect(await listVersions(api.origin, projectId)).toHaveLength(2);
  });

  it('accepts the empty reasoning wrapper emitted by local Qwen', async () => {
    const wrap = (value: unknown) =>
      `<think>\n\n</think>\n\n${JSON.stringify(value)}`;
    const provider = await startProvider(async () => ({
      choices: [{ message: { content: wrap(shuohaoGeneratedScript()) } }],
    }), async () => ({
      choices: [{ message: { content: wrap({
        verdict: 'approve',
        summary: '本地 Qwen 独立审阅通过。',
        findings: [],
      }) } }],
    }));
    const api = await startApi({
      endpoint: provider.origin,
      model: 'qwen-reasoning-wrapper',
      timeout_ms: 2_000,
    });
    const projectId = await createProject(api.origin, 'Qwen 包装兼容');

    const response = await post(
      `${api.origin}/api/projects/${projectId}/scripts/generation`,
      generationInput(),
    );

    expect(response.status).toBe(201);
    expect(await listVersions(api.origin, projectId)).toHaveLength(2);
  });

  it('does not create a draft when the model response is not valid JSON',
    async () => {
      const provider = await startProvider(async () => ({
        choices: [{ message: { content: '这不是 JSON' } }],
      }));
      const api = await startApi({
        endpoint: provider.origin,
        model: 'broken-model',
        provider: 'broken-provider',
        timeout_ms: 2_000,
      });
      const projectId = await createProject(api.origin, '坏响应');

      const generationResponse = await post(
        `${api.origin}/api/projects/${projectId}/scripts/generation`,
        generationInput(),
      );
      await expectError(
        generationResponse,
        502,
        'SCRIPT_GENERATION_RESPONSE_INVALID',
      );
      const versionsResponse = await fetch(
        `${api.origin}/api/projects/${projectId}/scripts`,
      );
      expect(data<unknown[]>(await versionsResponse.json())).toHaveLength(1);
    });

  it('repairs one quality-gate failure before persisting the draft', async () => {
    let requestCount = 0;
    const provider = await startProvider(async () => {
      requestCount += 1;
      const content = shuohaoGeneratedScript();
      if (requestCount === 1) content.episodes[0]!.scenes =
        content.episodes[0]!.scenes.slice(0, 1);
      return { choices: [{ message: { content: JSON.stringify(content) } }] };
    });
    const api = await startApi({
      endpoint: provider.origin,
      model: 'repair-model',
      provider: 'repair-provider',
      timeout_ms: 2_000,
    });
    const projectId = await createProject(api.origin, '质量门修复');

    const response = await post(
      `${api.origin}/api/projects/${projectId}/scripts/generation`,
      generationInput(),
    );
    expect(response.status).toBe(201);
    const result = ScriptGenerationResultSchema.parse(data(await response.json()));
    expect(result.generation.attempt_count).toBe(2);
    expect(result.document.scenes).toHaveLength(2);
    expect(requestCount).toBe(2);
  });

  it.each(qualityRepairCases())(
    'repairs the $name quality violation before persistence',
    async ({ mutate, feedback }) => {
      const requests: unknown[] = [];
      const provider = await startProvider(async (body) => {
        requests.push(body);
        const content = shuohaoGeneratedScript();
        if (requests.length === 1) mutate(content);
        return { choices: [{ message: { content: JSON.stringify(content) } }] };
      });
      const api = await startApi({
        endpoint: provider.origin,
        model: 'quality-model',
        provider: 'quality-provider',
        timeout_ms: 2_000,
      });
      const projectId = await createProject(api.origin, `质量门 · ${feedback}`);

      const response = await post(
        `${api.origin}/api/projects/${projectId}/scripts/generation`,
        generationInput(),
      );

      expect(response.status).toBe(201);
      expect(requests).toHaveLength(2);
      expect(providerUserMessage(requests[1])).toContain(feedback);
    },
  );

  it('maps provider HTTP and envelope failures without creating a draft',
    async () => {
      const rejected = await startRawProvider(async (_body, response) => {
        response.writeHead(429).end('rate limited');
      });
      const malformed = await startProvider(async () => ({ not_choices: [] }));
      for (const [provider, code] of [
        [rejected, 'SCRIPT_GENERATION_PROVIDER_FAILED'],
        [malformed, 'SCRIPT_GENERATION_RESPONSE_INVALID'],
      ] as const) {
        const api = await startApi({
          endpoint: provider.origin,
          model: 'error-model',
          timeout_ms: 2_000,
        });
        const projectId = await createProject(api.origin, `Provider ${code}`);
        const response = await post(
          `${api.origin}/api/projects/${projectId}/scripts/generation`,
          generationInput(),
        );
        await expectError(response, 502, code);
        expect(await listVersions(api.origin, projectId)).toHaveLength(1);
      }
    });

  it('cuts off a chunked provider response after one megabyte', async () => {
    const provider = await startRawProvider(async (_body, response) => {
      response.writeHead(200, {
        'content-type': 'application/json',
        connection: 'close',
      });
      response.end('x'.repeat(1_000_001));
    });
    const api = await startApi({
      endpoint: provider.origin,
      model: 'oversize-model',
      timeout_ms: 2_000,
    });
    const projectId = await createProject(api.origin, '超大响应');

    const response = await post(
      `${api.origin}/api/projects/${projectId}/scripts/generation`,
      generationInput(),
    );

    await expectError(response, 502, 'SCRIPT_GENERATION_RESPONSE_INVALID');
    expect(await listVersions(api.origin, projectId)).toHaveLength(1);
  });

  it('keeps the provider timeout active while reading the body', async () => {
    const provider = await startRawProvider(async (_body, response) => {
      response.writeHead(200, {
        'content-type': 'application/json',
        connection: 'close',
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (!response.destroyed) response.end('{}');
    });
    const api = await startApi({
      endpoint: provider.origin,
      model: 'slow-body-model',
      timeout_ms: 20,
    });
    const projectId = await createProject(api.origin, '慢响应体');

    const response = await post(
      `${api.origin}/api/projects/${projectId}/scripts/generation`,
      generationInput(),
    );

    await expectError(response, 504, 'SCRIPT_GENERATION_TIMEOUT');
    expect(await listVersions(api.origin, projectId)).toHaveLength(1);
  });

  it('does not call the provider when an editable draft already exists',
    async () => {
      let calls = 0;
      const provider = await startProvider(async () => {
        calls += 1;
        return { choices: [{ message: { content: JSON.stringify(
          shuohaoGeneratedScript(),
        ) } }] };
      });
      const api = await startApi({
        endpoint: provider.origin,
        model: 'unused-model',
        timeout_ms: 2_000,
      });
      const projectId = await createProject(api.origin, '已有草稿');
      const imported = await post(
        `${api.origin}/api/projects/${projectId}/scripts/import`, {
        title: '人工草稿',
        format: 'plain_text',
        content: 'SC-01 室内\n人物走进房间。',
      });
      expect(imported.status).toBe(201);

      const response = await post(
        `${api.origin}/api/projects/${projectId}/scripts/generation`,
        generationInput(),
      );

      await expectError(response, 409, 'SCRIPT_DRAFT_EXISTS');
      expect(calls).toBe(0);
    });

  it('rejects concurrent generation before a second provider call', async () => {
    let releaseProvider!: () => void;
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    const released = new Promise<void>((resolve) => { releaseProvider = resolve; });
    let calls = 0;
    const provider = await startProvider(async () => {
      calls += 1;
      markEntered();
      await released;
      return { choices: [{ message: { content: JSON.stringify(
        shuohaoGeneratedScript(),
      ) } }] };
    });
    const api = await startApi({
      endpoint: provider.origin,
      model: 'concurrency-model',
      timeout_ms: 2_000,
    });
    const projectId = await createProject(api.origin, '并发生成');
    const url = `${api.origin}/api/projects/${projectId}/scripts/generation`;

    const first = post(url, generationInput());
    await entered;
    const second = await post(url, generationInput());
    await expectError(second, 409, 'SCRIPT_GENERATION_ACTIVE');
    expect(calls).toBe(1);
    releaseProvider();
    expect((await first).status).toBe(201);
  });

  it('validates AI config before opening the SQLite database', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'h3-p23-invalid-config-'));
    directories.add(directory);
    const databasePath = join(directory, 'must-not-open.db');

    let captured: unknown;
    try {
      createApiServer({
        database_path: databasePath,
        port: 0,
        script_generation: {
          endpoint: 'file:///tmp/not-a-provider',
          model: 'invalid-provider',
        },
      });
    } catch (error) { captured = error; }
    expect(captured).toBeInstanceOf(ScriptGenerationConfigError);
    expect(captured).toMatchObject({ code: 'INVALID_ENDPOINT' });
    expect(existsSync(databasePath)).toBe(false);
  });

  it('rejects a timeout above the Node timer ceiling before opening SQLite',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'h3-p23-timeout-config-'));
      directories.add(directory);
      const databasePath = join(directory, 'must-not-open.db');

      let captured: unknown;
      try {
        createApiServer({
          database_path: databasePath,
          port: 0,
          script_generation: {
            endpoint: 'http://127.0.0.1:8080/v1',
            model: 'invalid-timeout-provider',
            timeout_ms: 2_147_483_648,
          },
        });
      } catch (error) { captured = error; }
      expect(captured).toBeInstanceOf(ScriptGenerationConfigError);
      expect(captured).toMatchObject({ code: 'INVALID_TIMEOUT' });
      expect(existsSync(databasePath)).toBe(false);
    });

  it('uses a fresh independent review call and persists its provenance',
    async () => {
      const reviews: unknown[] = [];
      const provider = await startProvider(async () => ({
        choices: [{ message: { content: JSON.stringify(
          shuohaoGeneratedScript(),
        ) } }],
      }), async (body) => {
        reviews.push(body);
        return approvedReview('approve_with_notes');
      });
      const api = await startApi({
        endpoint: provider.origin,
        model: 'review-model',
        provider: 'review-provider',
        timeout_ms: 2_000,
      });
      const projectId = await createProject(api.origin, '独立审阅');

      const response = await post(
        `${api.origin}/api/projects/${projectId}/scripts/generation`,
        generationInput(),
      );
      expect(response.status).toBe(201);
      const result = ScriptGenerationResultSchema.parse(data(await response.json()));
      expect(reviews).toHaveLength(1);
      expect((reviews[0] as { messages: unknown[] }).messages).toHaveLength(2);
      expect(providerUserMessage(reviews[0])).toContain('请独立审阅');
      expect(result.document.version.generation_review).toMatchObject({
        verdict: 'approve_with_notes',
        provider: 'review-provider',
        model: 'review-model',
        review_method: 'fresh_context',
        reviewed_revision: 0,
      });
      const firstScene = result.document.scenes[0]!;
      const saved = await put(
        `${api.origin}/api/projects/${projectId}/scripts/${result.document.version.id}`,
        {
          expected_revision: result.document.version.revision,
          title: result.document.version.title,
          scenes: result.document.scenes.map((scene) => ({
            ...scene,
            beats: scene.beats.map((beat) => beat.id === firstScene.beats[0]?.id
              ? { ...beat, text: '创作者修改了开场动作。' } : beat),
          })),
        },
      );
      expect(saved.status).toBe(200);
      const edited = data<{
        version: {
          revision: number;
          source_format: string;
          generation_review: { reviewed_revision: number };
          generation_input: { premise: string };
          generation_source_content: string;
        };
      }>(await saved.json());
      expect(edited.version).toMatchObject({
        revision: 1,
        source_format: 'plain_text',
        generation_review: { reviewed_revision: 0 },
        generation_input: { premise: generationInput().premise },
      });
      expect(edited.version.generation_source_content).toContain('"hook"');
    });

  it('does not persist a draft rejected by the independent reviewer',
    async () => {
      const provider = await startProvider(async () => ({
        choices: [{ message: { content: JSON.stringify(
          shuohaoGeneratedScript(),
        ) } }],
      }), async () => ({ choices: [{ message: { content: JSON.stringify({
        verdict: 'revise',
        summary: '人物动机存在阻断问题。',
        findings: [{
          severity: 'blocker',
          issue: '决定没有铺垫',
          evidence: '人物直接要求对方留下',
          suggestion: '增加一个能够触发决定的动作',
        }],
      }) } }] }));
      const api = await startApi({
        endpoint: provider.origin,
        model: 'reject-model',
        timeout_ms: 2_000,
      });
      const projectId = await createProject(api.origin, '审阅拒绝');

      const response = await post(
        `${api.origin}/api/projects/${projectId}/scripts/generation`,
        generationInput(),
      );

      await expectError(response, 422, 'SCRIPT_GENERATION_REVIEW_REJECTED');
      expect(await listVersions(api.origin, projectId)).toHaveLength(1);
    });

  it('keeps review current when locking changes status but not content',
    async () => {
      const provider = await startProvider(async () => ({
        choices: [{ message: { content: JSON.stringify(
          shuohaoGeneratedScript(),
        ) } }],
      }));
      const api = await startApi({
        endpoint: provider.origin,
        model: 'lock-model',
        timeout_ms: 2_000,
      });
      const projectId = await createProject(api.origin, '仅状态变化');
      const generated = await post(
        `${api.origin}/api/projects/${projectId}/scripts/generation`,
        generationInput(),
      );
      const draft = ScriptGenerationResultSchema.parse(
        data(await generated.json()),
      ).document;

      const lockedResponse = await post(
        `${api.origin}/api/projects/${projectId}/scripts/${draft.version.id}/lock`,
        { expected_revision: draft.version.revision },
      );

      expect(lockedResponse.status).toBe(200);
      const locked = data<{ version: {
        status: string;
        revision: number;
        generation_review: { reviewed_revision: number };
      } }>(await lockedResponse.json());
      expect(locked.version).toMatchObject({
        status: 'locked',
        revision: 1,
        generation_review: { reviewed_revision: 1 },
      });
    });

  it.each([
    ['non-JSON verdict', '不是审阅 JSON'],
    ['approve with blocker', JSON.stringify({
      verdict: 'approve',
      summary: '错误地批准。',
      findings: [{ severity: 'blocker', issue: '阻断问题',
        evidence: '文本证据', suggestion: '必须修改' }],
    })],
  ])('rejects an invalid independent review: %s', async (_name, content) => {
    const provider = await startProvider(async () => ({
      choices: [{ message: { content: JSON.stringify(
        shuohaoGeneratedScript(),
      ) } }],
    }), async () => ({ choices: [{ message: { content } }] }));
    const api = await startApi({
      endpoint: provider.origin,
      model: 'invalid-review-model',
      timeout_ms: 2_000,
    });
    const projectId = await createProject(api.origin, '无效独立审阅');

    const response = await post(
      `${api.origin}/api/projects/${projectId}/scripts/generation`,
      generationInput(),
    );

    await expectError(response, 502, 'SCRIPT_GENERATION_REVIEW_INVALID');
    expect(await listVersions(api.origin, projectId)).toHaveLength(1);
  });

  it.each(['http', 'timeout'] as const)(
    'does not persist when the independent review hits a %s failure',
    async (failure) => {
      const provider = await startRawProvider(async (body, response) => {
        if (providerUserMessage(body).includes('请独立审阅')) {
          if (failure === 'http') {
            response.writeHead(503, { connection: 'close' }).end('offline');
            return;
          }
          response.writeHead(200, {
            'content-type': 'application/json',
            connection: 'close',
          });
          await new Promise((resolve) => setTimeout(resolve, 80));
          if (!response.destroyed) response.end('{}');
          return;
        }
        const json = JSON.stringify({ choices: [{ message: {
          content: JSON.stringify(shuohaoGeneratedScript()),
        } }] });
        response.writeHead(200, {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(json),
        }).end(json);
      });
      const api = await startApi({
        endpoint: provider.origin,
        model: 'review-failure-model',
        timeout_ms: failure === 'timeout' ? 20 : 2_000,
      });
      const projectId = await createProject(api.origin, `审阅 ${failure}`);

      const response = await post(
        `${api.origin}/api/projects/${projectId}/scripts/generation`,
        generationInput(),
      );

      await expectError(response, failure === 'timeout' ? 504 : 502,
        failure === 'timeout'
          ? 'SCRIPT_GENERATION_TIMEOUT' : 'SCRIPT_GENERATION_PROVIDER_FAILED');
      expect(await listVersions(api.origin, projectId)).toHaveLength(1);
    },
  );
});

interface ScriptAiConfig {
  endpoint: string;
  api_key?: string;
  model: string;
  provider?: string;
  timeout_ms?: number;
}

async function startApi(scriptGeneration?: ScriptAiConfig,
  existingDatabasePath?: string) {
  const directory = existingDatabasePath ? null
    : await mkdtemp(join(tmpdir(), 'h3-p23-'));
  if (directory) directories.add(directory);
  const databasePath = existingDatabasePath ?? join(directory!, 'storyboard.db');
  const server = createApiServer({
    database_path: databasePath,
    port: 0,
    script_generation: scriptGeneration,
  });
  apiServers.add(server);
  const address = await server.start();
  return { origin: address.origin, databasePath, server };
}

async function startProvider(
  reply: (body: unknown) => Promise<unknown>,
  reviewReply: (body: unknown) => Promise<unknown> = async () => approvedReview(),
): Promise<{ origin: string }> {
  return startRawProvider(async (body, response) => {
    const result = providerUserMessage(body).includes('请独立审阅')
      ? await reviewReply(body) : await reply(body);
    const json = JSON.stringify(result);
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(json),
    });
    response.end(json);
  });
}

function approvedReview(verdict: 'approve' | 'approve_with_notes' = 'approve') {
  return { choices: [{ message: { content: JSON.stringify({
    verdict,
    summary: verdict === 'approve' ? '独立审阅通过。' : '通过，保留非阻断建议。',
    findings: verdict === 'approve' ? [] : [{
      severity: 'note',
      issue: '可继续压缩对白',
      evidence: '当前对白已经可懂',
      suggestion: '人工编辑时可酌情再收紧',
    }],
  }) } }] };
}

async function startRawProvider(
  reply: (body: unknown, response: ServerResponse) => Promise<void>,
): Promise<{ origin: string }> {
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    await reply(body, response);
  });
  providerServers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error(
    'Provider test server did not obtain a TCP address',
  );
  return { origin: `http://127.0.0.1:${address.port}/v1` };
}

function qualityRepairCases(): Array<{
  name: string;
  feedback: string;
  mutate: (script: ReturnType<typeof shuohaoGeneratedScript>) => void;
}> {
  return [
    {
      name: 'missing action',
      feedback: '至少需要一个动作节拍',
      mutate: (script) => {
        script.episodes[0]!.scenes[0]!.flow = [{
          speaker: '苏晚宁',
          line: '今晚别走。',
          delivery: '平静',
        }];
      },
    },
    {
      name: 'long dialogue',
      feedback: '超过 35 字',
      mutate: (script) => {
        script.episodes[0]!.scenes[0]!.flow[1] = {
          speaker: '苏晚宁',
          line: '这是一句故意写得非常非常非常非常非常非常非常非常长的中文对白用来触发质量门',
          delivery: '平静',
        };
      },
    },
    {
      name: 'speaker outside scene',
      feedback: '不在本场角色中',
      mutate: (script) => {
        script.episodes[0]!.scenes[0]!.flow[1] = {
          speaker: '陌生人',
          line: '今晚别走。',
          delivery: '平静',
        };
      },
    },
    {
      name: 'duration outside tolerance',
      feedback: '预估时长',
      mutate: (script) => {
        for (let index = 0; index < 12; index += 1) {
          script.episodes[0]!.scenes[0]!.flow.push({
            action: `额外的可见动作 ${index + 1}`,
          });
        }
      },
    },
    {
      name: 'late hook',
      feedback: '前 3 个节拍',
      mutate: (script) => { script.episodes[0]!.hookBeat = [2, 4]; },
    },
    {
      name: 'duplicate scene key',
      feedback: '重复，必须唯一',
      mutate: (script) => {
        const duplicate = structuredClone(script.episodes[0]!.scenes[0]!);
        script.episodes[0]!.scenes[1] = duplicate;
      },
    },
    {
      name: 'duplicate episode key',
      feedback: '分集编号 1 重复',
      mutate: (script) => {
        const secondScene = script.episodes[0]!.scenes.pop()!;
        script.episodes.push({
          ep: 1,
          targetSeconds: 7.5,
          hook: '第二集钩子',
          cliff: '第二集悬念',
          beatsClaimed: [],
          hookBeat: [1, 1],
          scenes: [secondScene],
        });
      },
    },
    {
      name: 'late hook in a later episode',
      feedback: '第 2 集的开场钩子',
      mutate: (script) => {
        const secondScene = script.episodes[0]!.scenes.pop()!;
        script.episodes.push({
          ep: 2,
          targetSeconds: 7.5,
          hook: '第二集钩子',
          cliff: '第二集悬念',
          beatsClaimed: [],
          hookBeat: [1, 4],
          scenes: [secondScene],
        });
      },
    },
  ];
}

function providerUserMessage(body: unknown): string {
  const messages = (body as { messages: Array<{ role: string; content: string }> })
    .messages;
  return messages.find(({ role }) => role === 'user')?.content ?? '';
}

async function listVersions(origin: string, projectId: string):
Promise<unknown[]> {
  const response = await fetch(`${origin}/api/projects/${projectId}/scripts`);
  return data<unknown[]>(await response.json());
}

function generationInput() {
  return {
    title: '上海雨夜 · AI 草稿',
    premise: '一对旧情人在上海雨夜重逢，女方决定结束长期逃避。',
    genre: '民国爱情悬疑',
    target_duration_seconds: 15,
    target_scene_count: 2,
    characters: ['苏晚宁：克制但主动', '顾承渊：寡言，习惯回避'],
    tone: '电影感、自然中文对白、克制',
    constraints: '不增加旁白，不出现声音、配乐或音效说明。',
  };
}

function shuohaoGeneratedScript() {
  return {
    source: '上海雨夜 · AI 草稿',
    episodes: [{
      ep: 1,
      targetSeconds: 15,
      hook: '两人在雨巷突然重逢',
      cliff: '顾承渊决定跟她进门',
      beatsClaimed: [],
      hookBeat: [1, 1],
      scenes: [
        {
          sceneId: 'S01',
          heading: '外 · 石库门雨巷 · 夜',
          location: '石库门雨巷',
          timeOfDay: '夜',
          lighting: '冷色路灯映在湿石板上',
          summary: '苏晚宁和顾承渊在巷口重逢。',
          characters: ['苏晚宁', '顾承渊'],
          props: ['油纸伞'],
          flow: [
            { action: '苏晚宁停在檐下，顾承渊收伞走近。' },
            { speaker: '苏晚宁', line: '今晚别走。', delivery: '平静而坚定' },
            { action: '顾承渊看向她，没有立刻回答。' },
          ],
        },
        {
          sceneId: 'S02',
          heading: '内 · 石库门厢房 · 夜',
          location: '石库门厢房',
          timeOfDay: '夜',
          lighting: '油灯暖光',
          summary: '顾承渊终于跨过门槛。',
          characters: ['苏晚宁', '顾承渊'],
          props: ['油纸伞'],
          flow: [
            { action: '苏晚宁推开门，让出半步。' },
            { speaker: '顾承渊', line: '好。', delivery: '低声' },
            { action: '苏晚宁看着他，终于松开门把。' },
            { action: '顾承渊把伞靠在门边，跨过门槛。' },
          ],
        },
      ],
    }],
  };
}

async function createProject(origin: string, title: string): Promise<string> {
  const response = await post(`${origin}/api/projects`, {
    title,
    script_title: `${title} V1`,
    script_content: '这是项目现有且已经锁定的初始剧本版本，AI 生成不得覆盖它。',
  });
  expect(response.status).toBe(201);
  return data<{ id: string }>(await response.json()).id;
}

function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function postWithNodeHttp(url: string, body: unknown): Promise<{
  status: number;
  body: string;
}> {
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': payload.byteLength,
      },
    }, async (response) => {
      const chunks: Buffer[] = [];
      try {
        for await (const chunk of response) chunks.push(Buffer.from(chunk));
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      } catch (error) { reject(error); }
    });
    request.once('error', reject);
    request.end(payload);
  });
}

function put(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function data<T>(body: unknown): T {
  return (body as { data: T }).data;
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => {
    if (error) reject(error);
    else resolve();
  }));
}
