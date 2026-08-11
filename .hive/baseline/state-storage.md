# State Storage

> SQLite 单库（默认 `~/.h3storyboard/h3storyboard.db`，可用 `H3_STORYBOARD_DB` 覆盖）。所有写入先落库再改内存投影。schema 变更走编号 migration，记录于 `schema_version`。当前 **v14**（2026-08-11，M1B-2）。

## Migration 索引（packages/project-store/src/migrations.ts + migration-v*.ts）
- v1–v5（M0）：projects、script versions、shot_plans、shot_actuals、h3_jobs（lease 状态机）、assets（当时含 NOT NULL content_hash）、QC verdict
- v6：canvas_nodes（画布节点：node_type shot_plan/character、x/y/w/h/z_index）
- v7：characters + character_references（canonical_appearance、seed_family、派生血缘 derived_from、candidate/approved/archived）
- v8：assets 原位扩展（uri/status/replaces_asset_id；content_hash 空串哨兵=协议 null，见 ADR evolve-existing-assets-table）+ current_assets_manifests + manifest_entries（不可变快照）+ character_references.asset_id
- v9：modes（全局 production Mode registry，candidate/validated/blocked + evidence）
- v10：production_briefs（append-only，project 内版本单调）+ project_generation_locks（单行锁表，见 ADR）+ h3_jobs.lock_snapshot_json
- v11：shot_plans 加 semantic_references/opening_state/ending_state JSON 列 + h3_jobs.compiled_bindings_json
- v12：shot_actuals representative 字段（partial unique index 保证每镜一个）+ h3_jobs.gate_override_reason
- v13：M1A review 整改——旧 image reference_bindings 回填 semantic_references；路径穿越校验恢复
- v14：h3_jobs.cancel_reason；provider_job_id/output_asset_id 沿用既有列，worker 完成时 asset/job/pending take 单事务落库

## 关键不变量
- planned（shot_plans）与 actual（shot_actuals）分离，QC verdict 与 representative approve 独立
- job 创建需 engaged lock，固化 lock_snapshot{brief_version, manifest_version, mode_key}，事后不可变
- manifest 冻结后不可变；资产替换在替身 approve 时才归档旧资产（原子转移）
- archived（asset/character）不可逆；migration 逐编号检查可恢复
- 锁定期间拒绝：brief 追加、资产状态迁移、manifest 冻结、shot 语义引用/角色参考/mode capability 修改
- timed_out job reclaim 保留 provider_job_id 并只轮询同一 provider task；worker 新输出必须为真实 sha256，candidate asset + completed job + pending take 原子提交

## 前端持久化
- 画布节点位置：SQLite canvas_nodes（v6 起；localStorage 只作一次性迁移来源）
