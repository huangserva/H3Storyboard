import {
  GeneratedShuohaoScriptSchema,
  type GenerateScriptInput,
  type GeneratedShuohaoScript,
  ScriptGenerationReviewDecisionSchema,
  type ScriptGenerationReviewDecision,
} from '@h3storyboard/protocol';

export function parseGeneratedScript(content: string):
  | { success: true; data: GeneratedShuohaoScript }
  | { success: false; issues: readonly string[] } {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(content.trim());
  const candidate = fenced?.[1] ?? content.trim();
  const decoded = parseJson(candidate);
  if (decoded === null) return { success: false,
    issues: ['响应必须是一个完整 JSON 对象，不能夹带说明文字'] };
  const result = GeneratedShuohaoScriptSchema.safeParse(decoded);
  if (!result.success) return { success: false, issues: result.error.issues.map(
    (issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`) };
  return { success: true, data: result.data };
}

export function inspectQuality(script: GeneratedShuohaoScript,
  input: GenerateScriptInput): string[] {
  const issues: string[] = [];
  const episodeIds = new Set<number>();
  const sceneIds = new Set<string>();
  for (const episode of script.episodes) {
    if (episodeIds.has(episode.ep)) issues.push(
      `分集编号 ${episode.ep} 重复，必须唯一`);
    episodeIds.add(episode.ep);
    for (const scene of episode.scenes) {
      const sceneKey = `E${episode.ep}-${scene.sceneId}`;
      if (sceneIds.has(sceneKey)) issues.push(
        `场景编号 ${sceneKey} 重复，必须唯一`);
      sceneIds.add(sceneKey);
    }
  }
  const scenes = script.episodes.flatMap(({ scenes }) => scenes);
  if (scenes.length !== input.target_scene_count) issues.push(
    `场景数必须是 ${input.target_scene_count}，当前为 ${scenes.length}`);
  for (const scene of scenes) {
    if (!scene.flow.some((beat) => 'action' in beat)) issues.push(
      `${scene.sceneId} 至少需要一个动作节拍`);
    const speakers = new Set(scene.characters);
    for (const beat of scene.flow) {
      if ('line' in beat && nonWhitespaceLength(beat.line) > 35) issues.push(
        `${scene.sceneId} 的对白“${beat.line}”超过 35 字`);
      if ('speaker' in beat && beat.speaker !== 'VO' &&
        !speakers.has(beat.speaker)) issues.push(
        `${scene.sceneId} 的说话人“${beat.speaker}”不在本场角色中`);
    }
  }
  const seconds = estimateSeconds(script);
  const tolerance = input.target_duration_seconds * 0.15;
  if (Math.abs(seconds - input.target_duration_seconds) > tolerance) issues.push(
    `预估时长 ${seconds.toFixed(1)} 秒，必须落在目标 ` +
    `${input.target_duration_seconds} 秒的 ±15% 内`);
  for (const episode of script.episodes) {
    const [sceneOrdinal, beatOrdinal] = episode.hookBeat;
    const before = episode.scenes.slice(0, sceneOrdinal - 1).reduce(
      (sum, scene) => sum + scene.flow.length, 0);
    if (!episode.scenes[sceneOrdinal - 1]?.flow[beatOrdinal - 1] ||
      before + beatOrdinal > 3) issues.push(
      `第 ${episode.ep} 集的开场钩子必须在本集前 3 个节拍内具象兑现`);
  }
  return issues;
}

function estimateSeconds(script: GeneratedShuohaoScript): number {
  return script.episodes.reduce((total, episode) => total +
    episode.scenes.reduce((sceneTotal, scene) => sceneTotal +
      scene.flow.reduce((flowTotal, beat) => flowTotal + ('action' in beat
        ? 2.5 : Math.max(0.5, nonWhitespaceLength(beat.line) / 4.5)), 0), 0), 0);
}

function nonWhitespaceLength(value: string): number {
  return value.replace(/\s/g, '').length;
}

export const SYSTEM_PROMPT = `你是 H3Storyboard 的中文编剧。采用 shuohao novel-script 的方法：
剧本只负责戏，不写镜号、摄影机、图片提示词或视频提示词；动作与对白必须分成独立节拍。
对白必须是自然、可听懂的正常中文，每句不超过 35 个非空白字符。
禁止 TTS、配音、音乐、环境声、雨声、音效、拟音或任何声音设计字段。
只输出一个 JSON 对象，不要 Markdown，不要解释。`;

export const REVIEW_SYSTEM_PROMPT = `你是未参与剧本创作的独立中文短剧审阅者。
只根据创作者简报与匿名剧本文本审阅，不猜测生成过程，不修改剧本。
重点检查：故事是否兑现简报、人物动机与动作是否连贯、对白是否自然可懂、钩子与结尾是否成立、是否夹带镜头提示或声音设计。
禁止要求或建议 TTS、配音、音乐、环境声、雨声、音效、拟音或任何外部声音。
只输出 JSON：{"verdict":"approve|approve_with_notes|revise","summary":"结论","findings":[{"severity":"blocker|warning|note","issue":"问题","evidence":"剧本文本证据","suggestion":"修改建议"}]}。`;

export function reviewPrompt(input: GenerateScriptInput,
  script: GeneratedShuohaoScript): string {
  return `请独立审阅以下剧本。只有 blocker 才使用 revise；非阻断建议使用 approve_with_notes。

创作者简报：
标题：${input.title}
故事材料：${input.premise}
题材：${input.genre}
目标时长：${input.target_duration_seconds} 秒
目标场景数：${input.target_scene_count}
角色约束：${input.characters.join('；') || '无'}
气质：${input.tone || '无'}
额外限制：${input.constraints || '无'}

待审剧本：
${JSON.stringify(script)}`;
}

export function parseGenerationReview(content: string):
  | { success: true; data: ScriptGenerationReviewDecision }
  | { success: false; issues: readonly string[] } {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(content.trim());
  const candidate = fenced?.[1] ?? content.trim();
  const decoded = parseJson(candidate);
  if (decoded === null) return { success: false,
    issues: ['独立审阅必须返回完整 JSON 对象'] };
  const parsed = ScriptGenerationReviewDecisionSchema.safeParse(decoded);
  if (!parsed.success) return { success: false, issues: parsed.error.issues.map(
    (issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`) };
  if (parsed.data.verdict !== 'revise' && parsed.data.findings.some(
    ({ severity }) => severity === 'blocker')) return { success: false,
    issues: ['包含 blocker 时 verdict 必须是 revise'] };
  return { success: true, data: parsed.data };
}

export function generationPrompt(input: GenerateScriptInput): string {
  return `请从以下创作者简报生成一份结构化剧本草稿。

标题：${input.title}
故事材料：${input.premise}
题材：${input.genre}
目标总时长：${input.target_duration_seconds} 秒（按动作 2.5 秒/拍、对白 4.5 字/秒估算，允许 ±15%）
目标场景数：严格 ${input.target_scene_count} 场
角色约束：${input.characters.length > 0 ? input.characters.join('；') : '由剧情需要确定'}
气质：${input.tone || '服从故事材料'}
额外限制：${input.constraints || '无'}

JSON 必须严格使用：
{"source":"标题","episodes":[{"ep":1,"targetSeconds":数字,"hook":"开场钩子","cliff":"结尾悬念","beatsClaimed":[],"hookBeat":[场序号,节拍序号],"scenes":[{"sceneId":"S01","heading":"内/外 · 地点 · 时间","location":"地点","timeOfDay":"时间","lighting":"光线","summary":"本场变化","characters":["角色名"],"props":["道具"],"flow":[{"action":"一个可见动作"},{"speaker":"角色名","line":"正常中文对白","delivery":"表演提示"}]}]}]}

每场至少一个动作节拍；每集 hookBeat 必须指向本集前 3 个节拍之一；episode 编号和同集 sceneId 必须唯一；不要输出额外字段。`;
}

export function repairPrompt(input: GenerateScriptInput, previousResponse: string,
  feedback: readonly string[]): string {
  return `${generationPrompt(input)}

上一次输出没有通过确定性质量门：
${feedback.map((issue) => `- ${issue}`).join('\n')}

请修复并重新输出完整 JSON。上一次输出如下：
${previousResponse.slice(0, 500_000)}`;
}

function parseJson(value: string): unknown | null {
  try { return JSON.parse(value) as unknown; }
  catch { return null; }
}
