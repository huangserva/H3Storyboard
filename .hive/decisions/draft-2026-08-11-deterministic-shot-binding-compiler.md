# 决策：以纯函数编译语义引用并在 Job 固化有序 binding

**日期**: 2026-08-11
**状态**: 提案中
**关联**: plan.md → M1A · per-shot 语义引用与 opening/ending state

## 背景
ShotPlan 表达导演用途，H3 provider 接收有序上传槽。若 prompt 引用、上传资产与 job 记录各自组装，将无法保证“全部且仅有”，也无法在 manifest 或 brief 演进后复现旧 job。

## 决策
新增无 I/O 的 `compileBindings(shot, manifest, assets, characterReferences, capability)`：角色目标先解析到 manifest 内的 approved 参考资产，再按 frame 优先、其余声明顺序生成 binding。创建 job 时复用同一编译结果校验 submitted inputs，并将清单写入 `h3_jobs.compiled_bindings_json`，之后不可变。

## 理由
1. dry-run API 与 job 创建共享同一纯函数，避免预览和执行漂移。
2. job 固化 URI 与 asset id，manifest 后续版本不会改变已有生成上下文。
3. 稳定错误码区分缺失输入、无关输入与 Mode 能力不匹配。
2. ...

## 已知代价
- 当前语义 purpose 只覆盖图像型 i2v/fl2v/r2v；既有 v2v/rv2v 生命周期暂沿用原 binding 校验，视频/音频语义槽在 M3 补齐。
- opening/ending state 作为导演连续性记录持久化，但本阶段不参与 provider payload 编译。

## 结果（后写）
待 Orchestrator 审核后回填。
