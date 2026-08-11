# M1A 缺陷 review（2026-08-11，独立多 agent 验证，36 候选全验证，报告严重度前 10）

范围：`2c4359c..fe3e62c`（migration v7–v12 六刀）。9 个 correctness CONFIRMED + 1 个 cleanup CONFIRMED。

## F1 · binding-compiler.ts:75 — 模式推导死角
仅 last_frame 的 shot 推导为 t2v 但产出 1 个 binding：t2v 要求零 binding、编译清单又必须全提交 → 矛盾 422，永远建不了 job。reference_target_state 无 first_frame 同理（推导 fl2v 但只有 1 个 binding，fl2v 要求恰好 2 个）。

## F2 · job-operations.ts:57 — v2v/rv2v 被无条件编译拦死
createH3Job 先无条件跑 compileShotBindings，无语义引用的 shot 推导 t2v，在 v2v guard 生效前就抛 MODE_CAPABILITY_MISMATCH（报错提及用户从未请求的模式）。

## F3 · job-operations.ts:57 + migration v11 — 存量 shot 无 backfill
v11 让旧 shot 的 semantic_references 为 []（编译成 t2v），未从仍存在的 reference_bindings 回填 → 升级后所有旧连续性 shot 建 job 全部 422。测试里被迫给 legacy 流程插 updateShotPlan 就是证据。

## F4 · generation-locks.ts:38 — 存量项目全断粮
新规则要求 lock+brief+manifest 才能建 job，但 v9/v10 迁移不给存量项目 seed 任何 mode/brief/manifest → 升级后老项目连环 LOCK_REQUIRED→BRIEF_REQUIRED→MANIFEST_REQUIRED，无迁移内恢复路径。

## F5 · asset-operations.ts:72 — 路径穿越校验丢失
旧 schema 强制 relative_path 且 refine 拒绝绝对路径和 `..`；新 schema 可选并 fallback 到未校验的 uri → `uri: "../../../etc/passwd"` 直接入库进 relative_path。updateAsset:126 同病。

## F6 · shot-operations.ts:89 等 — 生成锁漏风
updateShotPlan / updateCharacterReference / updateMode 均无 requireGenerationUnlocked → 锁定期间可改语义引用/角色参考/mode 能力，job 的 lock_snapshot 见证的上下文与实际发给 provider 的输入脱节。

## F7 · asset-operations.ts:85 — 替换即归档砸穿冻结 manifest
replaces_asset_id 立即归档被替换的 approved 资产、替身却是 candidate → 冻结 manifest 里引用旧资产的 shot 全部 BINDING_MISSING_INPUT，直到人工 approve 新资产并重冻结。

## F8 · binding-compiler.ts:88 — resolveAsset 被归档资产遮蔽
只按 sort_order 取第一个 manifest 内的角色参考，不查资产状态 → 已归档的 sort 0 遮蔽同 manifest 内 approved 的 sort 1，编译报 BINDING_MISSING_INPUT。

## F9 · binding-compiler.ts:63 — 编译不校验资产 kind
video 资产可编译进 first_frame（图像槽）→ 提交时 ASSET_KIND_MISMATCH / ASSET_ROLE_KIND_MISMATCH 双向 422，错误只能试错发现，应在编译期拒绝。

## F10 · production-store.ts:43 — blocked mode 无运行时效力（cleanup）
createBrief 只查 mode 存在、编译器不看 validation_status → blocked 的 mode 照常支撑新 brief 和新 job，v9 状态机没有运行时牙齿。

## 同步要求（另两路 review 的整改项）
- **协议对齐**：docs/protocol.md 停在 1.0，六大实体族未入档 → 必须补 Protocol 1.1 章节（characters、assets+manifest、modes、briefs+locks+snapshot、semantic references+compiled bindings、representative gate），docs/architecture.md 同步补边界。
- **架构**：project-store.ts 正好 300 行压线 → 拆分（继续 ModeStore/TakeStore 的 facade 模式），任何后续功能前完成。
