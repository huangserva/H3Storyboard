---
title: H3Storyboard
started: 2026-08-11
current_phase: M1
status: active
last_review: 2026-08-11
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

### M1B · 单镜 H3 闭环 · open
- [ ] i2v / fl2v / r2v 绑定槽 + provider 校验
- [ ] r2v 走 HybridLoader（fl2va base + ref2va adaln overlay，blocks 30-49）：GPU 盒部署 + 同 prompt/seed 三方对照验证（见 research/2026-08-11-h3-hybrid-loader-assessment.md）
- [ ] 本地 ComfyUI adapter + submit/poll worker
- [ ] 下载、hash、canonical asset 注册、pending take
- [x] actual 结果捕获 + QC verdict 契约

### M2 · 无限画布 Studio · in_progress
- [x] 无限画布：分镜卡片自由布局、平移缩放、SQLite v6 `canvas_nodes` 持久化（含旧 localStorage 一次迁移）
- [x] 多分镜按 scene 聚簇并显示动态分组框（原型方案，待 user 体验反馈）
- [x] 角色库面板与画布联动（character node 共用 SQLite 布局/z-index）
- [x] 与 planned/actual 列视图通过工作区切换共存
- [x] 双击节点聚焦、原点复位、拖拽提升并持久化 z-index

### M3 · 多模态 H3 · open
- [ ] v2v / rv2v、视频音频引用槽、绑定审计、批量队列

## 参考源（已评估，见 .hive/research/）
- `director`（本地私有仓库，检视 commit cb7358b）— 生产政策参考：Mode 验证状态、资产生命周期、生成锁、opening/ending state、代表性 take 门禁 → 已吸收进 M1A
- `luojiang419/filmstoryboard`（检视 commit d7572b1）— 桌面工作台信息架构、项目/素材管理 → 借鉴思路，不复用代码（无 LICENSE）
- `scottmudge/ComfyUI_MinimaxH3HybridLoader`（MIT，检视 commit 861c7df）— r2v 质量根因（ref2va 训练缺陷）+ 混合加载解药 → M1B r2v 路径采纳
- `huangserva/h3-film-studio`（自家项目，检视 commit 8693cc7）— **唯一实跑通本地 H3 的参考**：ComfyUI submit/poll 契约（M1B adapter 蓝本）、三模式↔reference 用途映射、角色 bible 三重锚（Q2 证据）、H3 硬约束（÷32 / 17k+5 / 中文 Audio 行会被念出）、INTENT 协议 ≈ production brief 原型

## Scope
- in: 本地优先工作台、H3 生成编排、planned/actual 分离、QC
- out: 云端多租户、非 H3 模型（暂不）

## 已知 risk
- 见 .hive/baseline/risk-hotspots.md
- 画布 UI（M2）与 M1 后端闭环并行时的接口漂移

## 当前 phase
M1B — 单镜 H3 闭环启动（2026-08-11）：M1B-1 ComfyUI adapter（contract 级）→ M1B-2 submit/poll worker + 下载/hash/资产注册 → M1B-3 真机出片 + r2v-hybrid 对照验证（需与 user 协调 GPU 窗口）。本机即 GPU 盒（4090 48G，8190=H3 / 8188=Krea）。

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
