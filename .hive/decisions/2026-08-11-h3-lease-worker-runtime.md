# 决策：H3 lease worker 归属 task-engine，由 API 进程按环境开关装配

**日期**: 2026-08-11
**状态**: superseded（worker 归属仍有效；默认开关已由 `2026-08-14-studio-generation-worker-runtime.md` 修订）
**关联**: plan.md → M1B-2

> 注意：本文件记录 2026-08-11 的阶段性 opt-in 决策。当前运行时默认启动 worker，只有显式设置 `H3_WORKER=0` 才关闭；以 2026-08-14 决策和 `apps/api/src/main.ts` 为准。

## 背景
M1B-2 需要持久 lease、submit-once/poll-same-task、文件落盘和原子完成管线。`project-store` 已依赖 `task-engine` 的状态机，若 worker 反向直接依赖 `project-store` 会形成循环；独立常驻进程又会扩大本地部署面。当前产品是单机 API + SQLite，worker 必须默认关闭，避免在没有 GPU 窗口时意外提交。

## 决策
1. `H3LeaseWorker` 放在 `packages/task-engine`，依赖 `H3WorkerStore` 窄接口和 `h3-provider`，不依赖 `project-store` 实现。
2. `project-store` 实现 claim-next、恢复保留 provider task id、以及 asset + job + pending take 的单事务完成操作。
3. API 主进程只在 `H3_WORKER=1` 时打开第二个 WAL store connection 并启动 loop；默认不开启。
4. provider 输出先原子写本地文件并计算真实 sha256，再提交 SQLite 完成事务；数据库失败会尝试删除孤立文件。

## 理由
1. 依赖方向保持单向：project-store 继续复用 task-engine 状态机，worker 用接口注入获得持久操作。
2. 本地单进程部署最小，不新增 daemon/systemd；开关明确守住“零真实生成”的阶段边界。
3. SQLite 对 asset/job/actual 提供真正的全有或全无；文件系统无法与 SQLite 两阶段提交，采用临时文件 + rename + 失败补偿是本地最小正确方案。
4. `provider_job_id` 继续表示 provider task id；migration v14 补取消审计字段，review 整改 migration v15 再补提交前持久化的 `provider_client_id` 意图。

## 已知代价
- ComfyUI 没有应用级 idempotency key；本系统以持久 `client_id` + queue/history 认领把提交崩溃窗口收窄为可恢复协议，只有连续确认远端不存在时才重提。
- 取消可通过 AbortSignal 打断轮询；只对目标 prompt 执行 pending queue 删除或 running interrupt，避免干扰其他任务。当前 graceful shutdown 仍等待本轮结束。
- 文件已 rename 但 DB 事务失败时依赖 best-effort 删除；极端进程崩溃可能留下无 DB 引用的孤儿文件，后续可做只读 orphan audit。

## 结果（后写）

2026-08-12 的 M1B-3a 首跑验证了本决策的正常完成路径：先对 8188/8190
执行 `/free`，空闲显存由约 12.3 GiB 升至 32.6 GiB；worker 对真实 8190
只提交一次，持久化 provider task
`b41e6e4f-f3d9-43a3-be39-9337ff0dbd61` 后轮询至完成。submit→completed
耗时 75.644 秒，显存峰值 45,667 MiB，GPU 利用率峰值 100%。

完成管线产出 632,806 字节 MP4（H.264 480×864/24fps + AAC，5.167 秒），
sha256 为 `59b4fb1bc4a22f2da396a6641a25a244c2869e4ce743f457a57233d5d6182f05`；
candidate canonical asset、pending ShotActual 与 completed job 在同一完成事务后可见。
本次没有触发恢复路径；该路径仍由 M1B-2 的真实 HTTP stub + SQLite 集成测试覆盖。

2026-08-12 四路 review 整改新增 migration v15 与真实 HTTP + SQLite 崩溃窗口测试：
提交前落 `provider_client_id`，恢复从 queue/history 认领 prompt，认领不到才重提；轮询内续租，
timeout 进入可恢复态并中断目标 task。输出路径加入 attempt/lease 所有权，双 worker 竞争测试证明
陈旧 worker 不会覆盖或删除新 attempt 的已登记成片。
