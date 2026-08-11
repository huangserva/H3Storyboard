# 决策：H3 lease worker 归属 task-engine，由 API 进程按环境开关装配

**日期**: 2026-08-11
**状态**: 提案中
**关联**: plan.md → M1B-2

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
4. `provider_job_id` 已是 provider task id，继续复用可保持 Protocol 兼容，migration v14 只补取消审计字段。

## 已知代价
- 进程若在 ComfyUI 接受 prompt 后、`provider_job_id` 落库前崩溃，ComfyUI 本身没有 idempotency key，无法严格消除窄窗口重复提交；落库后恢复路径保证不重提交。
- API shutdown 会等待当前有限轮询结束；M1B-3 实跑后若停机延迟不可接受，再给 client poll 增加 abort signal。
- 文件已 rename 但 DB 事务失败时依赖 best-effort 删除；极端进程崩溃可能留下无 DB 引用的孤儿文件，后续可做只读 orphan audit。

## 结果（后写）
待 M1B-3 真机首跑后回填 submit/poll、显存释放和故障恢复实证。
