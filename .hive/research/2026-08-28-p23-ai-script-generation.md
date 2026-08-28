# P2.3 AI 剧本生成索引

交付报告：
[2026-08-28-p23-ai-script-generation.html](../reports/2026-08-28-p23-ai-script-generation.html)

## 决策

- 生成主链只采用 `eternityspring/shuohao-skills`：模型写结构化
  episode / scene / action-dialogue flow，代码做确定性结构与质量门。
- `zenstory-ai/drama-skills` 吸收 creator-first 输入、阶段所有权和审阅隔离：
  创作者材料与约束先进入 brief；确定性门通过后，由不携带生成上下文的独立
  reviewer call 给 verdict，生成结果不能冒充创作者确认。
- 不引入其他剧本仓库，不复制 shuohao 的 TTS、声音报告或下游媒体链。

## 上游事实

- 本地检视：`/Users/serva/development/shuohao-skills`，commit
  `0e5eb688ebf1b45e45c9bec31543aaa59e67c7bc`。
- `novel-outline` 明确是“四件模型写、一件脚本算”；`novel-script` 由宿主
  Claude/Codex 写场次和节拍，Node 脚本负责 seed / validate / render。
- 借用的确定性门：动作/对白分离、单句 ≤35 字、每场有动作、合法说话人、
  前 3 拍具象钩子、时长 ±15%。
- 本地检视：`/Users/serva/development/drama-skills`，commit
  `e2ebebe3c7aa1edeea812fbf7fd78c2ea6684933`。吸收创意/原文/约束输入和
  写作、审阅、创作者接受分权；不采用其声音标签。
- GitHub CLI 当前未认证，公开远端又被失效的 `127.0.0.1:7899` 代理阻断；
  本次实现以本地已克隆源码为证据，没有把无法在线核验的更新写成事实。

## H3 落点

- Protocol 2.2 / schema v28。
- `GET|POST /api/projects/:project_id/scripts/generation`。
- OpenAI-compatible 配置：`H3_SCRIPT_AI_ENDPOINT`、`H3_SCRIPT_AI_MODEL`，
  可选 key/provider/timeout。
- `approve | approve_with_notes | revise` 独立审阅；只持久化已接受 verdict
  及 reviewer provider/model/summary/findings/method/reviewed_revision。
- creator brief 与原始 shuohao JSON 独立保存；草稿编辑只改当前正文并把审阅
  标成“适用于生成时 revision”，不伪称审阅覆盖修改后的文本。
- 成功只创建 `draft ScriptVersion`，持久化生成与审阅 provenance；不移动
  `active_script_version_id`，不 lock/compile/approve，不创建 H3 Job。
- 页面是 `AI 生成剧本` / `导入已有剧本` 两个并列入口。
- 首轮格式或质量门失败只允许一次修复；两次失败不落库。
- 系统提示词和 UI 均禁止 TTS、配音、音乐、环境声、雨声与音效；媒体音轨仍
  服从“仅 H3 原生音频或静音”的既有硬约束。

## 代码入口

- `apps/api/src/script-generation.ts`
- `apps/api/src/script-generation-contract.ts`
- `apps/api/src/script-generation-provider.ts`
- `apps/studio/src/components/ScriptEntryPanel.tsx`
- `tests/integration/p23-script-generation.test.ts`
- `tests/e2e/p23-script-generation.spec.ts`

## 明确不在基础版

- 不做长篇小说分卷/RAG、多集批次续跑。
- 不做模型列表/密钥的浏览器管理界面；凭据仅在 API 进程环境中。
- 不做第二个生成上游或多 provider 路由。
- 不要求独立审阅使用另一个供应商/模型；基础版保证的是新请求、新上下文、
  严格 verdict 与 provenance。最终创作者锁定和 P2.2 导演批准仍是权威边界。
