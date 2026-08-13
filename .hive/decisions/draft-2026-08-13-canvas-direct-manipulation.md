# 决策：画布直接操作以协议门禁的对象动作层实现

**日期**: 2026-08-13
**状态**: 提案中
**关联**: plan.md → M2 · 无限画布 Studio

## 背景
user 已确认 H3Storyboard 当前画布不如 OiiOii 好用，核心差距是无法在对象旁直接完成编辑、生成、查看与下一步操作。源码核验同时发现，OiiOii 的优势来自业务卡片动作密度，并非成熟的框选/连线 node editor；其生成结果直接回填实体的做法与 H3Storyboard planned/actual 分离、生成锁和 take 门禁冲突。

## 决策
提议把“直接操作化”实现为画布节点上的薄动作层：节点提供主动作、状态、媒体 lightbox 和同视图 inspector；所有生成仍走权威的 preflight、immutable job、asset、pending actual、QC 和 representative gate。P0 不引入任意连线或新的业务实体语义。

## 理由
1. 保留 OiiOii 最有效的低跳转交互，同时不复制其 planned/result 混合模型。
2. 复用现有 H3 job、binding、lock、take 和 QC 协议，减少双写与状态漂移。
3. 先闭合单镜导演循环，再增加多选、批处理和语义连线，可用真实 HTTP + SQLite 测试逐层守门。

## 已知代价
- 需要为画布补 server-authoritative preflight 和 per-job 状态投影，不能只做按钮外观。
- 同视图 inspector 与卡片动作需明确组件边界，避免超过 UI 文件 250 行限制。
- 批量操作、对齐和连线延后到 P1/P2，首期不会成为通用 node editor。

## 结果（后写）
等待 user 对 P0/P1/P2 backlog 和交互骨架拍板后回填。
