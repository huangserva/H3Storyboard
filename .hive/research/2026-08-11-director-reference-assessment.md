# director 参考评估索引

- 完整报告：[`../reports/2026-08-11-director-reference-assessment.html`](../reports/2026-08-11-director-reference-assessment.html)
- 调研日期：2026-08-11
- 来源：本地 `/Users/serva/development/director`
- 检视提交：`cb7358b637c4cb2d03993a68a92e3a654a81a153`
- 许可证：MIT；本次只吸收方法和协议边界，没有复制源码或媒体。

## 核心判断

`director` 不是第三套应用，也不替代 H3 provider。它应成为 H3Storyboard 的生产政策参考层：Mode 决定叙事和质量门槛，H3Storyboard 保存可验证的项目/资产/任务事实，provider adapter 负责平台命令和实时能力。

## 可验证证据

1. Mode、style/reference assets、Tool 三层明确分离，且工具专属命令只留在 tool 文档：`director/SKILL.md:12-18,82-97`。
2. 候选 Mode/style/tool 必须声明验证状态，不可把文档适配冒充端到端验证：`director/SKILL.md:24-34,91-95`。
3. Cinematic Drama 生成前要求片段起止状态、资产表、可辨识元素矩阵、当前素材清单和项目级生成锁：`director/modes/cinematic-drama/workflow.md:32-46`。
4. Prompt 和资产使用稳定版本，`current-assets-manifest` 是唯一权威输入：同文件 `:48-54`。
5. 每个节点只接入实际出现的全部且仅有资产，并先做代表性片段再批量：同文件 `:67-72`。
6. 反复出现或身份关键元素必须资产化，候选未经确认不得用于正式生成：`director/modes/cinematic-drama/reference-development-guide.md:3-14,29-39`。
7. 每个生成请求必须完整重述开场状态，跨片段以 ending → opening 对齐：`director/modes/cinematic-drama/video-prompt-guide.md:42-47,84-90`。
8. 成功任务必须保留可追溯 ID、终态、URL 并下载落盘：`director/tools/libtv-cli.md:43-48`。

## H3Storyboard 决策

- 采纳：可扩展 Mode 及验证状态、资产候选/批准/归档生命周期、版本化当前素材清单、项目生成锁、语义需求到有序 binding 的编译、opening/ending state、代表性 take 门禁。
- 采纳执行纪律：每次 lease 只提交一次并轮询同一 provider task；只有下载、非空校验、hash 与资产登记全部成功后才能完成 job。
- 保留现有优势：`ShotPlan -> H3Job -> ShotActual` 不可变血缘、lease 状态机、SQLite migration、真实 HTTP + SQLite 测试。
- 不采纳为核心常量：Seedance 2.0 Pro、720p、15 秒、3–5 镜、具体 CLI 命令和模型别名。
- 先解决：`director` 的“片段”可以包含多镜，H3Storyboard 的 `ShotPlan` 当前表示单镜生成目标；Protocol 1.1 不能混淆二者。

## 实施顺序

1. 先完成 ADR 0002 与 M1A 协议设计。
2. 再做 Protocol 1.1 + SQLite migration + 真 HTTP 穿透测试。
3. 然后接真实 provider worker；任务必须保存 manifest/lock 快照。
4. 最后开放批量队列，并以代表性 take 的显式批准作为前置条件。
