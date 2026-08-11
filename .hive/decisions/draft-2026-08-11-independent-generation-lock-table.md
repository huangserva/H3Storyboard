# 决策：项目生成锁使用独立单行表

**日期**: 2026-08-11
**状态**: 提案中
**关联**: plan.md → M1A · 导演级生产契约

## 背景
M1A-4 要给每个项目增加可 engage/release 的生成冻结状态，并记录时间与原因。可选方案是在 `projects` 主表追加四个字段，或建立项目一对一的锁表。

## 决策
使用 `project_generation_locks` 独立表，`project_id` 为主键与外键。未产生过锁操作的项目没有行，读取时投影为明确的 unlocked 状态；首次 engage 后通过同一行保存 engaged、时间和 reason。`h3_jobs.lock_snapshot_json` 只保存创建时解析出的不可变上下文，不引用可变锁行。

## 理由
1. 不扩大核心 `projects` 行，也不迫使所有历史项目回填仅用于生成编排的空字段。
2. 锁状态、审计时间和原因具有独立生命周期，单行表更贴合其事务边界。
3. job 快照复制 brief/manifest/mode 版本与 engage 时间，解锁或后续版本演进不会改变历史 job。

## 已知代价
- 读取项目与锁需要额外查询；当前本地 SQLite 单项目操作下成本可忽略。
- 本轮只保留最近一次 engage/release 状态，不提供完整锁事件历史；如需审计链应另建 append-only lock events。

## 结果（后写）
v10、锁内写入拦截、job snapshot 和真实 HTTP+SQLite 测试已实现；等待架构 review 后决定是否转为已采纳。
