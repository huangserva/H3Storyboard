# 决策：Production Mode capability declaration 的可扩展边界

**日期**: 2026-08-11
**状态**: 提案中
**关联**: plan.md → M1A · 导演级生产契约

## 背景
Production Mode 是叙事与质量政策，不是单次 H3 job 的生成模式。它需要声明可用生成能力和验证证据，同时不能把当前 provider 或 loader 的全部实现细节固化进核心协议。现有 `ProviderRegistry` 注册运行时 adapter，本次不能再造一个并行的内存 registry。

## 决策
Mode 作为 SQLite 中的全局持久资源；capability declaration 的核心字段由 Zod 强校验：`generation_modes`、时长范围、分辨率范围、LoRA/profile 要求和 provider 要求。实现专属配置进入 JSON `extensions`。Mode 证据状态只允许 `candidate → validated → blocked → candidate`，前两次升级/阻断必须提交 evidence。

## 理由
1. 核心能力边界可被 Studio/API 可靠读取并验证，不依赖说明文档或自由文本。
2. `extensions` 能承载 hybrid loader 等候选实现，避免每个实验都触发协议迁移。
3. 持久 Mode 与运行时 ProviderRegistry 职责分离：前者保存生产政策和证据，后者保存当前进程可调用的 adapter。

## 已知代价
- `extensions` 内部语义由具体能力实施方负责二次校验；仅保证它是合法 JSON。
- Mode 本轮不关联 project，M1A-4 production brief 引用时需要新增版本化外键/快照。

## 结果（后写）
v9、全局 API、真实 HTTP+SQLite 状态机测试与 Studio 面板已实现；等待架构 review 后决定是否转为已采纳。
