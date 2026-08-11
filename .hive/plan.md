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

### M1A · 导演级生产契约 · open
- [ ] Mode registry、production brief、锁快照
- [ ] Asset 生命周期（candidate/approved/archived）+ 血缘
- [ ] **角色定义**：角色作为一等实体（外观、参考图、状态），接入 per-shot 语义引用绑定
- [ ] 代表性 take 审批门

### M1B · 单镜 H3 闭环 · open
- [ ] i2v / fl2v / r2v 绑定槽 + provider 校验
- [ ] 本地 ComfyUI adapter + submit/poll worker
- [ ] 下载、hash、canonical asset 注册、pending take
- [x] actual 结果捕获 + QC verdict 契约

### M2 · 无限画布 Studio · in_progress
- [x] 无限画布原型：分镜卡片自由布局、平移缩放、浏览器本地位置持久化
- [x] 多分镜按 scene 聚簇并显示动态分组框（原型方案，待 user 体验反馈）
- [ ] 角色库面板与画布联动
- [x] 与 planned/actual 列视图通过工作区切换共存

### M3 · 多模态 H3 · open
- [ ] v2v / rv2v、视频音频引用槽、绑定审计、批量队列

## 参考源（已评估，见 .hive/research/）
- `director`（本地私有仓库，检视 commit cb7358b）— 生产政策参考：Mode 验证状态、资产生命周期、生成锁、opening/ending state、代表性 take 门禁 → 已吸收进 M1A
- `luojiang419/filmstoryboard`（检视 commit d7572b1）— 桌面工作台信息架构、项目/素材管理 → 借鉴思路，不复用代码（无 LICENSE）
- `huangserva/h3-film-studio`（自家项目，检视 commit 8693cc7）— **唯一实跑通本地 H3 的参考**：ComfyUI submit/poll 契约（M1B adapter 蓝本）、三模式↔reference 用途映射、角色 bible 三重锚（Q2 证据）、H3 硬约束（÷32 / 17k+5 / 中文 Audio 行会被念出）、INTENT 协议 ≈ production brief 原型

## Scope
- in: 本地优先工作台、H3 生成编排、planned/actual 分离、QC
- out: 云端多租户、非 H3 模型（暂不）

## 已知 risk
- 见 .hive/baseline/risk-hotspots.md
- 画布 UI（M2）与 M1 后端闭环并行时的接口漂移

## 当前 phase
M1 + M2 画布原型提前 — user 2026-08-11 要求先搭无限画布看效果（公网 106 可访问）；M1 后端契约随后推进

## 2026-08-11 M2 原型交付状态
- Studio 原型与演示数据已完成，质量门禁通过。
- 106 nginx 与反向隧道链路在中转机本地验证可达；公网 `9994` 超时，需 user 开放阿里云安全组。
- 本机 systemd unit 已纳入 `ops/systemd/`，安装/启用受本机 sudo 凭证阻塞；当前使用同参数前台隧道临时承载。
