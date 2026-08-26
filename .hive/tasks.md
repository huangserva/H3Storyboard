# Tasks

## In progress

### P2 后续

- [ ] P2.3：可选 AI 剧本生成；不得越过 draft、校验和人工锁定，不得引入任何外部声音。

### （M1B 已完成，归档见 Done）

- [x] **全栈工程师** dispatch `478c3bf6` — 任务：M1B-1——ComfyUI H3 adapter（TypeScript，contract 级）+ 只读能力发现。蓝本：h3-film-studio 的 scripts/local_providers.py

- [x] **全栈工程师** dispatch `d5958f44` — 任务：M1B-2——H3 provider lease worker：submit-once / poll-same-task / 恢复 + 完成管线（下载→非空校验→hash→canonical 资产注册→pending take）。蓝…
- [x] **全栈工程师** dispatch `27720881` — 任务：M1B-3a——H3 真机首跑（i2v 冒烟，走完整 M1A 契约）。user 已确认 GPU 无人使用，解除零生成禁令：允许对 8188/8190 POST（含 /free、/prompt）。HybridLoader/r2v 对照…
- [x] **全栈工程师** dispatch `382b50e7` — 任务：M1B-3b——HybridLoader 安装 + r2v 真机对照实验。user 已确认 GPU 无人使用，允许重启 8190 ComfyUI（谨慎执行，见步骤 1）。参考：.hive/research/2026-08-11-h3…
- [x] **全栈工程师** dispatch `6403bb4a` — 任务：M1B-4——fl2v（首尾帧）路径补齐：graph builder + 真机冒烟。GPU 窗口仍有效（user 已授权），显存纪律照旧（生成前 /free 两实例、不杀进程、注意共享 GPU 外部队列——排队非空就等自然空闲，显式…
- [x] **全栈工程师** dispatch `670e7676` — 任务：M1B-4 续——fl2v 真机冒烟补跑。8190 外部批任务已排空（orch 监视器确认连续 3 分钟空闲），窗口现在有效。
- [x] **全栈工程师** dispatch `846d2a77` — 任务：M1B 收尾整改——修复四路 review 发现的 W1–W10，修完并复验后 M1B 才宣告 done。完整 findings 与修法方向见 docs/reviews/m1b-bug-review.md，逐条修复逐条回执。
- [x] **全栈工程师** dispatch `b2303b68` — 任务：紧急小刀——Studio 视频播放：媒体文件服务端点 + actual 面板内嵌播放器。user 正等着在浏览器看 5 个 pending take 的成片，优先级最高，做小做快。
- [x] **全栈工程师** dispatch `4cf55d02` — 任务：画布视觉缺陷修复（user 截图反馈，三处）。优先级高，做完 user 直接刷新验收。
- [~] **全栈工程师** dispatch `647d8527` — 任务：Studio 生成按钮——把'点一下出片'的最后闭环补上。user 要直接在浏览器里用，优先级最高。 ⊘ worker 进程退出且无任何提交落地，dispatch 作废；任务将重新派发
- [x] **全栈工程师2** dispatch `bfcba78a` — 任务：【调研，不写实现代码】深挖 xyz 的 OiiOii 画布交互模型，产出 H3Storyboard 画布'直接操作化'改造方案。user 拍板：现画布不如 OiiOii 好用，核心差距是'能在画布上直接操作'。完整任务书见 .hiv…
- [x] **全栈工程师2** dispatch `ef22abdf` — 任务：Studio 生成按钮全链路（重派——上一 worker 中途退出，git log 确认零提交落地，从头开始，不要假设有半成品）。
## Done

### 2026-08-26 · P2.2 Plan Review（done）
- [x] compilation 级 draft/approved/superseded plan-set 与项目 active pointer；显式批准原子切换。
- [x] Scene/Beat 来源、逐镜 diff、严格字段编辑、revision 冲突和未保存修改门禁；声音字段不可编辑。
- [x] approved Plan 解锁现有 H3；superseded Plan 禁止新 Job/retry，但旧 Job 同 key 回放和历史 Take 不变。
- [x] 真 HTTP + SQLite 覆盖编辑、回滚、并发、来源损坏、历史与 H3 门禁；真实 Chromium 覆盖完整导演用户链。
- [x] 最终门禁 279 passed / 1 live skip + 25 Chrome；四路复审 B / B / B- / A-。

### 2026-08-26 · P2.1 Script Studio（done）
- [x] plain text / shuohao JSON 导入；Scene/Beat UUID、状态与时长持久化。
- [x] draft-only 编辑、确定性校验、锁定/supersede、幂等编译和来源血缘。
- [x] 草稿 ShotPlan 不可创建单镜或批量 H3 Job；全链零 4090、零外部音频。
- [x] 真 HTTP + SQLite 集成测试和真实 Chromium 完整用户链。
- [x] 最终门禁 272 passed / 1 live skip + 25 Chrome；四路复审 B- / B / B+ / A-。

### 2026-08-25 · M3A worker 批量编排（done）
- [x] 持久 batch、全部未完成批次进度、最近完成历史与 Protocol 1.9 / schema v23。
- [x] 真 SQL 单 Job claim：batch↔batch、recovery↔draft、unbatched↔batch 公平调度，同毫秒计数兜底。
- [x] immutable per-shot retry、provider task 身份转移、旧 ancestor 禁止 claim/cancel、Chrome 失败后同 key 重试。
- [x] 43 个 Vitest 文件（268 passed / 1 skipped）与 24 个 Chrome E2E；四路最终复审均 ≥ B-。

### 2026-08-24 · M2 P1.2 可直接测试画布（done）
- [x] 真实 approved Character reference 与静音 MP4 fixture；幂等独立 seed，强制 `H3_WORKER=0`，零 4090 请求。
- [x] Job→output Asset→Take 精确血缘、Inspector/lightbox、Take/QC/代表片与刷新持久化。
- [x] 真 HTTP + SQLite + Chrome 覆盖媒体解码/Range/中断释放、同镜重选、拖拽中 refocus 与 100 Shot；Vitest 133 passed / 1 skipped，Playwright 8 passed。
- [x] 架构/bug/测试/spec 四路独立 review 均达到 B- 以上，无严重项。

### 2026-08-12 · M1B 单镜 H3 闭环（done，commit 4055bc0 收官）
三种模式（i2v/fl2v/r2v+hybrid）真机证据齐全；四路 review W1–W10 整改闭环，92 tests：
- [x] M1B-1 ComfyUI contract adapter（e0c4f1c）· M1B-2 lease worker + 完成管线（dbc2559，v14）· M1B-3a 真机 i2v 首跑（3031a56）· M1B-3b HybridLoader + r2v 对照（9aec643）· M1B-4 fl2v（545fc5a）· review 整改 W1–W10（4055bc0，v15）

### 2026-08-11 · M1A 导演级生产契约（done，commit 70d83c7 收官）
六刀 + review 整改全部完成；四路 review（架构 B+/缺陷 9+1 findings 修复/测试 A-/协议 1.1 补齐）通过：
- [x] **全栈工程师** dispatch `fe091938` — M1A-1 角色实体（migration v7，commit 8174da0）
- [x] **全栈工程师** dispatch `3900177d` — M1A-2 资产生命周期 + immutable manifest（v8，d2490e3）
- [x] **全栈工程师** dispatch `90ba2bd7` — M1A-3 Mode registry（v9，ee35ccf）
- [x] **全栈工程师** dispatch `28cb8a14` — M1A-4 brief + 生成锁 + job 锁快照（v10，33d9845）
- [x] **全栈工程师** dispatch `6cabf28d` — M1A-5 语义引用 + 起止状态 → binding 编译（v11，58fc506）
- [x] **全栈工程师** dispatch `f8822e0a` — M1A-6 代表性 take 门禁（v12，fe3e62c）
- [x] **全栈工程师** dispatch `d584aa6c` — 四路 review 整改 F1–F10 + Protocol 1.1 文档 + store 拆分（v13，70d83c7）

### 2026-08-11 · M2 画布提前批
- [x] **全栈工程师** dispatch `34a29e50` — 画布原型 + 106 nginx/临时隧道；安全组已由 user 放行，systemd unit 待 sudo 安装（Q4）。
- [x] **全栈工程师** dispatch `0213387b` — 画布第二轮：SQLite v6 canvas_nodes、CRUD、旧布局迁移、zoomToNode、复位和 z-index（commit 2c4359c）。
