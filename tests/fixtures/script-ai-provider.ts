import { createServer } from 'node:http';

const port = Number(process.env.H3_E2E_SCRIPT_AI_PORT ?? 4188);

const generated = {
  source: '上海雨夜 · AI 草稿',
  episodes: [{
    ep: 1,
    targetSeconds: 15,
    hook: '两人在雨巷突然重逢',
    cliff: '顾承渊跨过门槛',
    beatsClaimed: [],
    hookBeat: [1, 1],
    scenes: [
      {
        sceneId: 'S01',
        heading: '外 · 石库门雨巷 · 夜',
        location: '石库门雨巷',
        timeOfDay: '夜',
        lighting: '冷色路灯映在湿石板上',
        summary: '两人在巷口重逢。',
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
          { action: '苏晚宁终于松开门把。' },
          { action: '顾承渊把伞靠在门边，跨过门槛。' },
        ],
      },
    ],
  }],
};

const review = {
  verdict: 'approve_with_notes',
  summary: '独立审阅通过；对白清楚，人物行动连续。',
  findings: [{
    severity: 'note',
    issue: '后续可人工微调节奏',
    evidence: '第二场以连续动作收束',
    suggestion: '编辑草稿时可按成片节奏微调',
  }],
};

const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
    messages?: Array<{ role?: string; content?: string }>;
  };
  const userMessage = body.messages?.find(({ role }) => role === 'user')?.content;
  const content = userMessage?.includes('请独立审阅') ? review : generated;
  const json = JSON.stringify({ choices: [{ message: {
    content: JSON.stringify(content),
  } }] });
  response.writeHead(200, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(json),
  });
  response.end(json);
});

server.listen(port, '127.0.0.1', () => process.stdout.write(
  `P2.3 test AI provider listening on http://127.0.0.1:${port}\n`,
));

const close = () => server.close(() => process.exit(0));
process.once('SIGINT', close);
process.once('SIGTERM', close);
