# 决策：用持久 client_id 意图恢复 ComfyUI 提交崩溃窗口

**日期**: 2026-08-12
**状态**: 提案中
**关联**: plan.md → M1B-2 / M1B review 整改

## 背景
ComfyUI `/prompt` 成功与 `provider_job_id` SQLite 落库之间存在进程崩溃窗口。仅靠 prompt id 无法恢复，直接重提会重复占用 GPU 并产生重复成片。

## 决策
在调用任何 provider I/O 前为 job 写入唯一 `provider_client_id`。恢复时依次按已知 prompt id、client id 查询 `/history` 与 `/queue`；发现现存 task 就认领并继续轮询。只有连续确认 history 与 queue 都不存在时，才原子清除旧意图并生成新的 client id 重提。

## 理由
1. ComfyUI 在 queue item 和 history prompt metadata 中保留 `client_id`，足以关联已经接受但本地尚未记录 prompt id 的任务。
2. 意图先写库符合“数据库写先于投影/外部副作用”的项目纪律。
3. 历史 job 的 nullable 字段允许 additive migration，不破坏现有项目。
2. ...

## 已知代价
- ComfyUI 若重启并同时清空 queue/history，无法证明旧任务从未执行；系统会在连续缺失确认后重提，并保留 attempt/event 审计。
- 认领依赖 ComfyUI 当前 queue/history JSON 形态，contract stub 与真机回归需持续覆盖。

## 结果（后写）
migration v15 与恢复逻辑已在 commit `4055bc0` 实施。真实 HTTP + SQLite 测试证明提交崩溃后按 client id 认领且 `/prompt` 调用为零，ComfyUI 重启清空 queue/history 后才生成新意图重提。post-fix 真机 i2v 同时落库 client id 与 prompt id 并单次完成。
