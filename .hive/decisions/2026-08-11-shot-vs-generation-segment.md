# ADR（draft）：镜头（camera shot）与生成段（generation segment）边界

- 日期：2026-08-11
- 状态：accepted（user 2026-08-11 拍板选 A）
- 关联：docs/plan.md M1A 前置问题 · .hive/research/2026-08-11-director-reference-assessment.md（结论第 30 行）· h3-film-studio 实证

## 背景

director 的"片段"可以包含多个镜头；H3Storyboard 的 `ShotPlan` 当前表示单镜生成目标。Protocol 1.1（M1A 核心迁移）动手前必须锁死这个边界，否则 planned/actual 血缘和 binding 编译会两义。

## 备选

- **A（推荐）**：`ShotPlan` = 一次 H3 生成段 = 一个 H3 job = 一段成片素材（2–15s）。一个生成段内若刻意包含多机位切换（H3 可用 prompt 表达），记为 ShotPlan 上的表达属性（prompt 内部结构），不建新实体。场景（scene）继续作为分组层。
- **B**：引入独立 `Segment` 实体：Segment 1..n CameraShot，job 挂在 Segment 上。表达力强但多一层血缘，M1 阶段没有消费方。

## 推荐 A 的理由（实证）

1. h3-film-studio 与 xyz 全部实跑记录都是"一个 prompt → 一段 clip"，逐段生成逐段 QC；没有出现需要把一段 clip 内部的多镜头单独追溯的场景。
2. planned/actual 血缘、rerun、QC 都以 job 为粒度，A 保持 `ShotPlan -> H3Job -> ShotActual` 一一对应，不引入两义。
3. B 可以在真实需求出现时（如"段内某一镜单独重生成"）通过新增实体向后兼容地演进；反向从 B 退回 A 则是破坏性的。

## 已知代价（A）

- 段内多机位无法单独 rerun——只能整段重生成。按 h3-film-studio 经验（整段 seed 抽卡重跑），可接受。

## 结果

选定方案 A：ShotPlan = 一次 H3 生成段 = 一个 job = 一段 2–15s 素材；段内多机位为 prompt 表达属性，不建新实体。Protocol 1.1 迁移按此设计，血缘保持 ShotPlan -> H3Job -> ShotActual 一一对应。
