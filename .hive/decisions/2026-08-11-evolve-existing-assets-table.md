# 决策：v8 增量扩展既有 assets 表

**日期**: 2026-08-11
**状态**: accepted（orch 架构 review 通过 2026-08-11，附 M1B 清理条件）
**关联**: plan.md → M1A · 导演级生产契约

## 背景
v1–v5 已有 `assets` 表承载 H3 输入、输出与派生帧，M1A-2 又要求加入资产生命周期、替换血缘和权威 manifest。新建同名领域表或重建旧表都会扩大迁移风险，并可能破坏既有 H3Job/QC 记录。

## 决策
v8 原位增加 `uri`、`status`、`replaces_asset_id`、`updated_at`，保留 `name`、`relative_path`、`producer_job_id` 和既有派生字段作为兼容扩展。历史资产回填为 `approved`；新登记资产默认为 `candidate`。旧 `content_hash NOT NULL` 物理约束暂不重建，协议中的 `null` 以空字符串存储、读取时映回 `null`。

## 理由
1. 保持既有 H3 输入绑定、生成输出和 QC 外键稳定，不改 ShotPlan/H3Job 语义。
2. SQLite `ALTER TABLE ADD COLUMN` 可小步、可重放地升级现有用户数据库。
3. HTTP 协议可立即表达 M1A 的 nullable hash 与生命周期，同时不阻断旧调用方的相对路径字段。

## 已知代价
- 数据库内部用空字符串表示未回填 hash，必须统一经过 row mapper 才能得到协议层 `null`。
- 资产响应暂时包含兼容字段；未来清理需单独版本化协议与迁移，不能直接删除。

## 结果（后写）
v8 migration、真实 HTTP+SQLite 状态机/manifest 测试和 Studio 资产面板均已实现（commit d2490e3，39 tests 过）。orch review 结论：接受——重建表的外键风险大于空串哨兵的代价，且哨兵已收敛在 row mapper 单点。绑定条件：M1B 落地真实 hash 计算时回填全部空串；届时若仍有残留，再评估是否做表重建迁移。
