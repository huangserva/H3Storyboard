# 决策：R2V graph 用显式 loader 配置隔离 stock 与 hybrid

**日期**: 2026-08-12
**状态**: 提案中
**关联**: plan.md → M1B-3b

## 背景
同一份 r2v 生成图需要能在 stock `UNETLoader(ref2va)` 与
`MiniMaxH3HybridLoader(fl2va + ref2va AdaLN 30–49)` 之间切换，同时保持
reference conditioning、采样器、prompt、seed、输出链完全相同，才能形成
可解释的真机对照。loader 选择不能散落在 graph 的多个节点中。

## 决策
新增 `buildH3R2VGraph`，接收判别联合 `H3R2VLoader`：`stock` 只生成
`UNETLoader`；`hybrid` 只替换 loader 节点并显式固化 base、overlay、preset
及 block range。两者共用同一 ReferenceToVideo、SigmaShift、sampler、decode
和 SaveVideo 图。worker 通过注入的 `r2v_loader` 选择本次运行配置。

## 理由
1. 对照变量只有 loader，避免把画质差异误归因于采样或 reference 顺序。
2. 判别联合让无效 block range 在提交前以稳定 provider 错误拒绝。
3. worker 默认 stock，HybridLoader 未安装的普通环境不会意外引用 custom node。

## 已知代价
- loader 配置当前由 worker 运行配置注入，job 仍以 `model` 文本和 Mode evidence
  审计；若未来同一常驻 worker 混跑多种 loader，需要把结构化 loader snapshot
  纳入 job 协议，而不是解析 `model` 字符串。

## 结果（后写）

2026-08-12 真机对照通过。stock ref2va 与 hybrid 使用同一 prompt、seed、
480×864/124f、turbo 4 steps 及两张有序参考图；两条 job 都经 worker
submit-once 完成并生成 H.264 + AAC 双流。

- stock：75.343 秒，显存峰值 46,875 MiB。
- hybrid：75.103 秒，显存峰值 45,107 MiB；Comfy 日志明确记录
  `base=fl2va overlay=ref2va preset=block_range_adaln blocks=30..49`。

hybrid 抽帧在人物身份、完整巷景和首秒可用性上优于 stock，且没有性能或
显存回归；仍存在手部/信封伪影。Mode 保持 candidate，等待 user 看片后再决定
是否采纳本 ADR 与升级 validated。
