---
title: H3Storyboard
started: 2026-08-11
current_phase: P2.3
status: active
last_review: 2026-08-28
---

## 目标

无限画布上的多分镜、带角色定义的 MiniMax H3 生成系统：
`完整剧本 -> 规划分镜 -> H3 编译 -> 任务执行 -> 实际分镜 -> QC`。
规划分镜（planned）与生成结果（actual）是分离的持久实体，QC 显式裁决。

## 里程碑

### M0 · 持久化导演基础 · done
- [x] 独立仓库 + 架构决策（docs/adr/0001、0002）
- [x] protocol / SQLite v1–v5 / 本地 API / Studio shell
- [x] 四路 review 全部 B- 以上
- 详细见 docs/plan.md（工程侧 delivery plan 以 docs/plan.md 为准）

### M1A · 导演级生产契约 · done
- [x] 可扩展 production Mode registry + candidate/validated/blocked 证据状态机
- [x] Production brief、项目生成锁与 job 不可变锁快照
- [x] Asset 生命周期（candidate/approved/archived）+ 血缘 + immutable current-assets manifest
- [x] **角色定义基础**：一等实体、canonical appearance、seed 族、参考图血缘与归档
- [x] 角色接入 per-shot 语义引用绑定 + opening/ending state + 确定性 H3 binding 编译
- [x] 代表性 take 审批门（与单条 QC 独立；重复 job 需 approved representative 或审计 override）

### M1B · 单镜 H3 闭环 · done
- [x] M1B-1：TypeScript ComfyUI contract adapter、I2V graph、提交前 H3 lint 与只读 capability discovery
- [x] i2v / fl2v / r2v 绑定槽 + provider 校验（FL2V 真机双流冒烟已完成）
- [x] r2v 走 HybridLoader（fl2va base + ref2va adaln overlay，blocks 30-49）：GPU 盒部署 + stock ref2va / hybrid 同 prompt、seed 对照（见 research/2026-08-12-m1b3b-hybrid-r2v-comparison.md）
- [x] M1B-2：submit-once / poll-same-task worker、lease 恢复与 provider 切换显存钩子
- [x] M1B-3：真实 graph 出片与 Mode evidence（3a i2v + 3b HybridLoader/r2v 对照均完成；Mode 仍为 candidate，待 user 看片）
- [x] 下载、hash、canonical asset 注册、pending take
- [x] actual 结果捕获 + QC verdict 契约

### M2 · 无限画布 Studio · done
- [x] P1：React Flow 产品画布与 `H3 原声 | 静音` 五层硬约束（commit `a621432`）
- [x] P1.1：canvas batch upsert + project batch preflight；100 Shot 首载固定为 1 次画布写入 + 1 次 preflight 读取
- [x] 无限画布：分镜卡片自由布局、平移缩放、SQLite v6 `canvas_nodes` 持久化（含旧 localStorage 一次迁移）
- [x] 多分镜按 scene 聚簇并显示动态分组框（原型方案，待 user 体验反馈）
- [x] 角色库面板与画布联动（character node 共用 SQLite 布局/z-index）
- [x] 与 planned/actual 列视图通过工作区切换共存
- [x] 双击节点聚焦、原点复位、拖拽提升并持久化 z-index
- [x] Actual 面板可切换并内嵌播放同镜真实 Take（Range 流式媒体端点），资产库图片可预览，pending QC 操作可见
- [x] 画布视觉整改：两侧资产/角色面板改独立占位且默认折叠；分镜卡显示 Take 首帧或真实 first_frame；缺文件缩略图显示稳定占位
- [x] 画布直接操作化：节点内生成/新 Take、同视图 inspector、per-job 进度、Take 预览与 QC（P1.2 已用真实媒体 fixture、精确 Job→Asset→Take 血缘和浏览器穿透收口）
- [x] P1.2 可测试画布：真实角色参考、两条可解码静音 MP4、媒体 lightbox、Take/QC/代表片、同镜重复聚焦、幂等离线 demo；`H3_WORKER=0`，不访问 4090
- [x] P1.3 制片墙：默认高密度角色大卡、场景资产带、三列 Plan/Latest Take 分镜墙；角色 catalog 单请求、真实图片上传/候选批准/多角度血缘、React Flow graph builder 拆分；旧 Flow 与计划/实测视图继续共存
- [x] P1.3B 真实角色图闭环：持久 CharacterImageJob、Krea/Qwen/Krea-i2i、
  8188/8190 共享 GPU lease、恢复/取消/重试、像素解码、candidate 血缘、
  manifest CTA；真实 4090 三路径与浏览器 E2E 均通过

### M3 · 多模态 H3 · in progress
- [x] M3A：持久批次、worker 跨批公平调度、跨镜进度、不可变逐镜重试与 Studio 重试入口
- [ ] M3B：v2v / rv2v、视频引用槽与绑定审计

### P2 · Script Studio · in progress
- [x] P2.1：plain text / shuohao 单上游导入、Scene/Beat 持久编辑、确定性校验、不可变锁定、带 Scene/Beat 来源的草稿 ShotPlan 编译
- [x] 草稿 Plan 单镜/批量 H3 双重门禁；剧本链路不访问 4090，不引入 TTS/BGM/环境音
- [x] P2.2：导演审阅、逐镜编辑/diff、显式批准后才进入现有 H3 生产链
- [x] P2.3：AI 生成 / 已有剧本导入双入口；shuohao 生成与确定性质量门、fresh-context 独立审阅、creator brief 与不可变生成来源血缘；继续服从 draft → validate → lock 边界

## 参考源（已评估，见 .hive/research/）
- `director`（本地私有仓库，检视 commit cb7358b）— 生产政策参考：Mode 验证状态、资产生命周期、生成锁、opening/ending state、代表性 take 门禁 → 已吸收进 M1A
- `luojiang419/filmstoryboard`（检视 commit d7572b1）— 桌面工作台信息架构、项目/素材管理 → 借鉴思路，不复用代码（无 LICENSE）
- `scottmudge/ComfyUI_MinimaxH3HybridLoader`（MIT，检视 commit 861c7df）— r2v 质量根因（ref2va 训练缺陷）+ 混合加载解药 → M1B r2v 路径采纳
- `huangserva/h3-film-studio`（自家项目，检视 commit 8693cc7）— **唯一实跑通本地 H3 的参考**：ComfyUI submit/poll 契约（M1B adapter 蓝本）、三模式↔reference 用途映射、角色 bible 三重锚（Q2 证据）、H3 硬约束（÷32 / 17k+5 / 中文 Audio 行会被念出）、INTENT 协议 ≈ production brief 原型
- `huangserva/xyz-video-creator`（私有，检视 commit 67d11bf）— OiiOii 的可借鉴核心是卡片内编辑/生成/重做/媒体查看/进度反馈，不是完整 node editor；直接回填结果的语义不可搬。详见 `research/2026-08-13-oii-canvas-interaction-model.md`

## Scope
- in: 本地优先工作台、H3 生成编排、planned/actual 分离、QC
- out: 云端多租户、非 H3 模型（暂不）

## 已知 risk
- 见 .hive/baseline/risk-hotspots.md
- 画布 UI（M2）与 M1 后端闭环并行时的接口漂移

## 当前 phase
P2.3 — 已补齐 AI 生成剧本与导入已有剧本的并列入口；shuohao 结构化生成先过确定性质量门和一次修复，再由 fresh-context reviewer 独立裁决，只有 accepted 结果保存为可编辑 draft。creator brief、原始生成 JSON、provider/model 和审阅证据均持久化，编辑后明确标记审阅已过期；全链不访问 H3/4090，不创建外部音频。P2.2 草稿分镜审阅与 plan-set 原子批准继续作为下游人工门禁；M3A 批量编排已完成；P1/P1.1/P1.2/P1.3/P1.3B 工程实现和真实 4090 三路径均完成；
P1.3B 已完成最终全量门禁与四路 review（B+ / B- / B- / B）。默认制片墙可直接本地体验，角色图完成后只进入
candidate，仍需导演人工批准。M1A/M1B 已完成工程实现、真实 i2v/fl2v/r2v
证据与四路 review 整改；Mode 仍保持 candidate，等待 user 看片后决定是否升 validated。

## 2026-08-28 P2.3 AI Script Generation 交付状态
- Protocol 2.2 / schema v28：生成 provider/model、独立审阅、creator brief 与不可变原始生成来源均持久化。
- Script Studio 提供“AI 生成剧本 / 导入已有剧本”两条并列入口；AI 接受创意、原文、题材、人物、时长、场景数和限制。
- shuohao 严格 JSON 生成后执行场景、动作、说话人、对白长度、时长、前 3 拍钩子和唯一 key 门禁；只允许一次自动修复。
- fresh-context 独立审阅拒绝或门禁二次失败均不落库；接受后仅写 draft，不能自动锁定、编译、批准或创建 H3 Job。
- 草稿保留生成与审阅 provenance；修改正文后审阅明确变为 stale，锁定状态变更不会制造假 stale。
- 全链不访问 4090，不添加 TTS、配音、音乐、环境音、雨声或音效；最终媒体继续只允许 H3 原生音频或静音。
- 最终门禁：48 个 Vitest 文件，305 passed / 1 个显式 live-ComfyUI skip；28 个真实 Chromium E2E 全过。四路复审 A- / A- / A- / A；详见 `reports/2026-08-28-p23-ai-script-generation.html`。

## 2026-08-26 P2.2 Plan Review 交付状态
- Protocol 2.1 / schema v25：PlanReview、compilation/plan revision、active plan-set 指针与 draft/approved/superseded 生命周期。
- Studio 支持 Scene/Beat 来源对照、逐镜 diff 与编辑；声音字段不可编辑，存在未保存修改时禁止批准。
- 批准在一个 SQLite transaction 内批准新集合、切换项目指针并 supersede 旧集合；失败全回滚，旧 Job/Take 历史不变。
- 新 Job 只允许 active approved Plan；旧 Job 保留同 key 幂等回放，superseded Plan 禁止新建或 retry。
- 2026-08-27 UI 修订：空画布不再重叠；空项目默认进入 Script Studio；增加五步引导、状态化 CTA、1024/700px 版本入口，以及 active/archived review 精确语义。
- 最终门禁：47 个 Vitest 文件，279 passed / 1 个显式 live-ComfyUI skip；27 个真实 Chromium E2E 全过。
- 四路最终复审：架构 A-、真实 bug A-、测试 B、协议 A；所有严重项均已整改，无跳过项。
- 本阶段不调用 4090，不添加 TTS、配音、音乐、环境音、雨声或音效。

## 2026-08-26 P2.1 Script Studio 交付状态
- Protocol 2.0 / schema v24：ScriptVersion draft/locked/superseded + revision 并发保护、ScriptScene/ScriptBeat、ScriptCompilation 与 ShotPlan 来源/服装/位置/道具血缘。
- Studio 支持 plain text 和唯一采用的 shuohao `novel-script` JSON；人工编辑角色、服装、位置、道具和时长，确定性校验后锁定并编译草稿 Plan。
- 编译幂等且每个锁定版本只允许一次；旧剧本、旧 Plan、Job、Take 不被改写。草稿 Plan 禁止单镜/批量 H3 创建。
- 不调用 4090；不添加 TTS、配音、音乐、环境音、雨声或音效。草稿 Plan 的 `sound` 恒为空。
- 最终门禁：45 个 Vitest 文件，272 passed / 1 个显式 live-ComfyUI skip；25 个真实 Chromium E2E 全过。
- 四路最终复审：架构 B-、真实 bug B、测试 B+、协议 A-；首轮 C+ 项已整改并复审过线。

## 2026-08-25 M3A 批量编排交付状态
- Protocol 1.9 / schema v23：持久 H3 batch、原始/当前 Job 血缘、跨镜聚合进度与不可变逐镜 retry。
- Worker 通过 SQL 单行 claim 在 batch、恢复任务和 unbatched Job 之间公平轮转；同毫秒由 `claimed_count` 裁决，旧 retry ancestor 永不再领取或取消。
- Studio 展示全部未完成批次和最近 3 个已完成批次；失败镜头可原位重试，500 后保留同一幂等键。
- `pnpm check && pnpm build && pnpm test` 全绿：43 个 Vitest 文件，268 passed / 1 既有 skip；24 个 Chrome E2E passed。
- 四路最终复审：架构 B-、真实 bug A-、测试 A、spec B+。报告：`reports/2026-08-25-m3-batch-orchestration.html`。

## 2026-08-11 M1A 角色交付状态
- commit `8174da0`：migration v7、Character/Reference API、归档纪律、角色库与 character canvas node；38 tests 通过。

## 2026-08-11 M1A 资产交付状态
- commit `d2490e3`：migration v8、Asset candidate/approved/archived 状态机、replacement 血缘、不可变且项目内单调递增的 current-assets manifest。
- 角色参考图可关联 `asset_id`，旧 `uri` 契约保留；Studio 已增加资产登记、审批、归档与 manifest 冻结入口。

## 2026-08-11 M1A Mode registry 交付状态
- commit `ee35ccf`：migration v9、全局 production Mode、可扩展 capability declaration、candidate→validated→blocked→candidate 证据状态机。
- Studio 已增加 Mode 创建、promote、block、reopen 入口；`r2v-hybrid` 保持 candidate，等待 M1B GPU 对照证据。

## 2026-08-11 M1A Production context 交付状态
- commit `33d9845`：migration v10、版本化 production brief、独立项目生成锁、H3 job 不可变 `{brief_version, manifest_version, mode_key, locked_at}` 快照。
- 锁定期间 brief 追加、资产状态迁移、manifest 冻结均拒绝；Studio 已提供 brief 新版本与 engage/release 操作入口。

## 2026-08-11 M1A Per-shot binding 编译交付状态
- commit `58fc506`：migration v11 将语义引用、opening/ending state 与 job 编译清单持久化；纯函数编译器只解析权威 manifest 内 approved 资产，按固定 slot 顺序拒绝缺失、无关和 Mode 能力不匹配输入。
- Studio 已提供镜头语义引用与起止状态编辑、dry-run 编译及画布就绪徽标；“雨夜来信”第 1 镜已通过真实 API 编译为有序 r2v 输入。

## 2026-08-11 M1A Representative take gate 交付状态
- commit `fe3e62c`：migration v12 将代表 Take 状态与 job 门禁 override 原因持久化；QC verdict 与代表审批保持独立，第二个及后续同镜 job 必须已有 approved representative 或显式记录 override。
- Studio 已提供标记、批准、拒绝、撤销操作；“雨夜来信”演示 Take 已标记并批准，同时保留 `qc_verdict=pending` 以证明两套裁决互不替代。
- M1A 工程 bullet 已全部落地；架构、缺陷、测试、协议四路独立 review 及整改均完成，里程碑已宣告 `done`。

## 2026-08-11 M1A 四路 review 整改状态
- commit `70d83c7`：逐项关闭 review F1–F10；migration v13 为旧 image bindings 回填语义引用，v2v/rv2v 保留原验证路径。
- Protocol 升至 1.1，六大实体族、状态机、稳定错误与 API 路由已入档；架构边界补齐，`ProjectStore` 拆出 `CharacterStore` 后为 252 行。
- `pnpm check && pnpm build && pnpm test` 全绿（8 files / 56 tests）；真实演示库升级到 schema v13，4 条资产路径全部通过 traversal 核验。

## 2026-08-11 M2 原型交付状态
- 首次 commit `cac91a9`：M0 全部 + M2 画布原型 + .hive PM 文档（134 files）。
- 第二轮 commit `2c4359c`：migration v6 + canvas node CRUD + 聚焦/z-index，37 tests 通过。
- Studio 原型与演示数据已完成，质量门禁通过。
- 106 nginx 与反向隧道链路在中转机本地验证可达；公网 `9994` 超时，需 user 开放阿里云安全组。
- 本机 systemd unit 已纳入 `ops/systemd/`，安装/启用受本机 sudo 凭证阻塞；当前使用同参数前台隧道临时承载。

## 2026-08-11 M1B-1 ComfyUI H3 adapter 交付状态
- commit `e0c4f1c`：`packages/h3-provider` 新增可注入 fetch 的 ComfyUI client、确定性 H3 I2V graph、尺寸/帧/prompt lint、只读 capability evidence。
- 本地真实 HTTP stub 覆盖 upload→submit→poll→download→free 及 4 类失败路径；默认测试不依赖 ComfyUI。
- `H3_COMFY_PROBE=1` 对 `127.0.0.1:8190` 只读探测通过：11 个所需节点全部 present；未调用真实 `/prompt`、`/upload/image` 或 `/free`，不把节点存在表述为端到端已验证。
- 调研双产出：`research/2026-08-11-comfyui-h3-adapter-contract.md` + `reports/2026-08-11-comfyui-h3-adapter-contract.html`。

## 2026-08-11 M1B-2 H3 lease worker 交付状态
- commit `dbc2559`：`task-engine` 新增接口驱动的 H3 worker；该提交最初为 opt-in。2026-08-14 的 runtime 决策已改为默认装配，只有显式 `H3_WORKER=0` 才关闭。
- submit 后先持久化既有 `provider_job_id`；过期 lease reclaim 保留并继续 poll 同一 task。migration v14 只补 `cancel_reason`，不重复已有 task/output 列。
- 下载非空 → 项目相对路径落盘 → 真实 sha256 → candidate canonical asset → pending take → completed job；三条 DB 记录在一个 immediate transaction 内可见。
- 真实 HTTP stub + SQLite 覆盖成功、恢复零重提交、零字节失败无半成品、hash、取消原因；Protocol 升至 1.2，Studio task drawer 显示 worker/job/provider task 状态。
- 本轮 `H3_WORKER` 未设置，对真实 8190/8188 零 POST；真机首跑仍属于 M1B-3。

## 2026-08-12 M1B-3a H3 i2v 真机首跑状态
- “雨夜来信”第 1 镜已用真实 480×864 首帧，经 approved asset → manifest v2 → semantic binding → generation lock → immutable job snapshot → worker submit/poll → candidate output asset → pending take 完成全链路。
- provider task `b41e6e4f-f3d9-43a3-be39-9337ff0dbd61` 仅提交一次，75.644 秒完成；输出 H.264 + AAC 双流 MP4 为 5.167 秒、632,806 字节，真实 sha256 已落库。
- `/free` 后空闲显存 32.6 GiB；生成期间峰值占用 45,667 MiB、最低空闲 2,835 MiB、GPU 利用率峰值 100%。生成锁完成后已释放。
- `cinematic-drama` 已写入本次 evidence，但按阶段纪律保持 `candidate`；M1B-3 整体仍等待 3b HybridLoader/r2v 对照，不提前宣告完成。
- 证据双产出：`research/2026-08-12-m1b3a-real-i2v-smoke.md` + `reports/2026-08-12-m1b3a-real-i2v-smoke.html`。

## 2026-08-12 M1B-3b HybridLoader / r2v 对照状态
- 8190 已安装 commit `861c7df` 的 `ComfyUI_MinimaxH3HybridLoader`；重启后 custom node 与原 11 个 H3 必需节点全部 present，8188 未重启。
- Krea 真实生成林澜 720×1280 主形象并以真 hash 登记；旧演示占位 asset 经 replacement 状态机归档，新 reference 进入 immutable manifest v3。镜头编译为 `first_frame` + `reference_character` 两个有序 r2v binding。
- commit `9aec643`：新增 stock/hybrid 显式 loader 的 raw `MiniMaxH3ReferenceToVideo` graph；worker 支持按编译顺序上传 r2v 图片，真实 HTTP + SQLite 测试覆盖。
- 同 prompt/seed 对照：stock 75.343 秒、峰值 46,875 MiB；hybrid 75.103 秒、峰值 45,107 MiB。两段均为 480×864、5.167 秒 H.264 + AAC，并生成 candidate asset + pending actual；两条 job 都记录 `gate_override_reason`。
- 抽帧显示 hybrid 的林澜身份、完整巷景与首秒质量优于 stock；手部/信封仍有生成伪影。`r2v-hybrid` evidence 已更新，validation status 保持 candidate，等待 user 看片。
- 运行中发现共享 GPU 队列竞态；生成前门禁随后改为显式失败并等待外部任务自然完成。详见 paired research/report。

## 2026-08-12 M1B-4 FL2V 状态
- commit `545fc5a`：新增 stock fl2va 首尾帧 Director graph；worker 严格按编译后的 `first_frame`、`last_frame` 上传并提交。单元快照及真实 HTTP stub + SQLite 集成已覆盖。
- 真实尾帧变体已用 ffmpeg 生成并以真 hash 注册 approved asset；manifest v4、brief v3、dry-run FL2V 两槽编译均完成。
- 初次真机窗口被共享 8190 外部 S4–S10 连续批处理阻塞；原子门禁未抢占，旧 draft job 安全取消。重试窗口连续确认空闲并 `/free` 两实例后，以全新 job `ac2ad96e` 成功完成。
- provider task `d807e4b5` 仅提交一次，75 秒完成；输出 480×864、5.167 秒 H.264 + AAC，532,582 bytes，sha256 `8836d771…e79117`；峰值显存 45,661 MiB。candidate asset + pending actual 落库，生成锁已释放。
- M1B 六项功能证据已齐，状态进入 `ready_for_review`；四路 review 由 Orchestrator 组织。证据双产出见 `research/2026-08-12-m1b4-fl2v-smoke.md` 与 `reports/2026-08-12-m1b4-fl2v-smoke.html`。

## 2026-08-12 M1B 四路 review 整改与终验
- commit `4055bc0` 关闭 W1–W10：migration v15 持久 `provider_client_id` submit intent，按 client id 认领崩溃窗口内任务；连续 history/queue 缺失才重提。
- poll 内 heartbeat、帧数动态预算、recoverable timeout、目标 task cancel/interrupt、job+slot 上传名、attempt+lease 输出所有权均有真实 HTTP + SQLite 回归。
- 三类 graph 共用 Director/LoRA/sampler/output 骨架；能力发现从 graph 节点 union 派生并由守护测试防漂移。Protocol 升 1.3。
- `pnpm check && pnpm build && pnpm test` 全绿（11 files；92 passed，1 opt-in probe skipped）。post-fix 真机 i2v job `c5685701` 单次提交，70.476 秒完成；480×864、5.167 秒 H.264 + AAC，真 hash、candidate asset、pending actual 与双 provider id 齐全，锁已释放。
- M1B 六项全部完成，四路 review 整改闭环，里程碑状态更新为 `done`。配对证据见 `research/2026-08-12-m1b-review-remediation.md` 与 `reports/2026-08-12-m1b-review-remediation.html`。

## 2026-08-24 M2 P1.1 批量首载与 preflight 交付状态
- Protocol 升至 1.5：新增幂等 canvas batch upsert 与 project batch preflight；保留单节点 CRUD 和单镜 preflight 兼容接口。
- 画布初始化在一个 SQLite immediate transaction 内预校验、写入并返回完整布局；多进程/多标签并发由唯一键裁决，旧布局默认不覆盖。
- preflight 在一个一致性读事务内复用 project/brief/lock/manifest/asset/character context，按 Shot ordinal 返回；Studio 首载与 StrictMode replay 共用请求，项目切换会终止旧请求。
- `pnpm check && pnpm build && pnpm test` 全绿：Vitest 124 passed / 1 skipped，Playwright 5 passed。四路最终评分 A=B-、B=B-、C=B+、D=A，无严重项遗留。
- 证据双产出：`research/2026-08-24-p11-batch-canvas-preflight.md` + `reports/2026-08-24-p11-batch-canvas-preflight.html`。

## 2026-08-24 M2 P1.2 可测试画布交付状态
- `pnpm demo:canvas` 幂等创建独立 `canvas-test.db`，真实 Store 生命周期形成 3 个 Plan、2 个 completed Job、2 个独立 Take；两段 MP4 为真实可解码视频且无音轨。
- Character approved reference、Job→output Asset→Take、Inspector、lightbox、Take/QC/代表片与刷新持久化已进入同一 React Flow 画布；计划分镜不会被实测结果覆盖。
- Demo 强制 `H3_WORKER=0` 且忽略继承的 `H3_STORYBOARD_DB`；production-start 测试用 ComfyUI sentinel 证明零请求。媒体 Range、symlink containment、中断流 FD 释放均有真 HTTP + SQLite 回归。
- `pnpm check && pnpm build && pnpm test` 全绿：Vitest 133 passed / 1 skipped，Playwright 8 passed。四路最终评分 A=B+、B=B+、C=B+、D=A-，无严重项或 M+1 blocker。
- 证据双产出：`research/2026-08-24-p12-canvas-test-ready.md` + `reports/2026-08-24-p12-canvas-test-ready.html`。
