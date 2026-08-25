# H3Storyboard 剧本与提示词上游评估索引

完整、自包含报告：

- [2026-08-25-script-prompt-upstream-assessment.html](../reports/2026-08-25-script-prompt-upstream-assessment.html)

## 核心结论

H3Storyboard 已有 `ScriptVersion` 协议和表，但当前只能在创建项目时把用户粘贴的文本直接锁定为 V1；没有草稿编辑、版本链、Scene/Beat、AI 写作、剧本校验或 Script → ShotPlan 编译。因此剧本不是“还不完善”，而是只有输入封套，没有产品工作流。

推荐新增 `P2 Script Studio`：

1. draft / locked / superseded 的真实版本生命周期；
2. 结构化 `ScriptScene` / `ScriptBeat`；
3. 点子、小说、大纲、现成剧本多入口；
4. 确定性时长、角色、场景、道具、覆盖和连续性门禁；
5. 锁定剧本后生成可审阅的草稿 ShotPlan，并保留 Scene/Beat 来源；
6. provider-specific、版本化 Prompt Recipe 与代表输出评测。

## 上游裁决

- `shuohao-skills`（Apache-2.0）：A。结构化剧本、确定性检查和 H3 多图时序最有价值；不迁 TTS/BGM/soundscape 与短剧硬编码。
- `drama-skills`（MIT）：A-。借 creator-first 体验、任意阶段进入和独立 review；Markdown 不作为 H3 业务真相。
- `webnovel-writer`（GPL-3.0）：B。仅借长篇事实链、投影和恢复思想，不复制代码，不把整套 RAG 装进核心。
- `awesome-gpt-image-2`（MIT）：B+。借 style library 与 Prompt-as-Code 组织角色/场景静帧配方；不直接复用 GPT-Image2 prompt。
- `make-prompt-seedance2`（无许可证）：C。只做模型差异对照，不复制代码或模板。
- `prompt-optimizer`（AGPL-3.0-only）：B-。借版本、变量、对比评测概念，不嵌入产品。

## 本地参考代码

- `/Users/serva/development/shuohao-skills`
- `/Users/serva/development/drama-skills`
- `/Users/serva/development/webnovel-writer`
- `/Users/serva/development/awesome-gpt-image-2`
- `/Users/serva/development/make-prompt-seedance2`
- `/Users/serva/development/prompt-optimizer`

## H3Storyboard 证据入口

- `packages/protocol/src/project.ts`
- `packages/protocol/src/shot.ts`
- `packages/project-store/src/project-operations.ts`
- `packages/project-store/src/migrations.ts`
- `apps/studio/src/components/ProjectComposer.tsx`

## 不变量

- SQLite + protocol 是唯一真相；Markdown 只作为可读导入/导出。
- Script、ShotPlan、H3 Job、Take 分离；剧本改版不重写生成历史。
- AI 产物先进入 draft 和质量门，人工锁定后才能编译镜头。
- 只允许 H3 原生声音或静音，不迁 TTS、配音、BGM、环境音、雨声或 SFX。
