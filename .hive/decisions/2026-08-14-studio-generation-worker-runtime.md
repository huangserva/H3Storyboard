# 决策：Studio 生成入口启用 API 内常驻 worker 与外部队列门禁

**日期**: 2026-08-14
**状态**: 已接受（2026-08-14 Orchestrator 验收：101 测试全绿含队列占用零写入证明；修订 2026-08-11 runtime ADR 默认关闭条款）
**关联**: plan.md → M2 Studio 生成全链路

## 背景
Studio 已从只读/QC 工作台推进到可创建真实 H3 job。若 API 启动但 worker
仍默认关闭，UI 会长期停在 queued，用户必须阅读环境变量文档才能完成主路径；
另一方面共享 8190 可能有外部 ComfyUI 批任务，常驻 worker 不能以 `/free` 或
新 prompt 抢占它们。该决策修订 2026-08-11 worker runtime ADR 中“默认关闭”的
阶段性约束，不改变 lease、submit intent 与原子完成协议。

## 决策
1. API 默认打开第二个 WAL store connection 并启动 `H3LeaseWorker`；仅当
   `H3_WORKER=0` 时关闭，供另行托管 worker 的部署使用。
2. 每次全新 provider submission 前先读取 ComfyUI `/queue`。running 或 pending
   任一非空即记录可恢复的 `H3_COMFY_QUEUE_BUSY`，不调用 `/free`、不上传、不提交。
3. 队列为空后必须先 `/free` 再上传绑定和提交 H3 graph；不提供跳过 `/free` 的
   运行开关。
4. 已持久化 `provider_job_id` / `provider_client_id` 的恢复路径仍优先认领并轮询
   原任务，不把自己的恢复任务误判为外部抢占。

## 理由
1. Studio 主路径开箱即用，job 不会因遗忘环境开关永久停在 draft。
2. pre-submit queue gate 把“常驻”与“不抢占共享 GPU”同时变为可测试协议。
3. 保留 API 内装配避免新增 daemon 生命周期，同时保留显式关闭口满足独立部署。

## 已知代价
- 外部队列持续占用时，job 会在 timed_out 可恢复态反复尝试并增加 attempt；后续可
  增加带退避的 `waiting_for_capacity` 状态，但本轮不扩 schema。
- `/queue` 为空到 `/prompt` 之间仍有第三方插队竞态；ComfyUI 不提供跨客户端原子
  claim，本轮保证不会主动干扰已观测到的外部任务。

## 结果（后写）
实现已具备真实 HTTP stub + SQLite 测试，证明外部队列占用时 `/free`、upload、
prompt 计数均为零。待四路 review 与 user 接受后再把本 draft 标为 accepted。
