# M1B 缺陷 review（2026-08-12，独立多 agent 验证，27 候选全验证，报告严重度前 10）

范围：`70d83c7..HEAD`（ComfyUI adapter、三 graph builder、H3LeaseWorker、完成管线、migration v14）。9 correctness（8 CONFIRMED + 1 PLAUSIBLE）+ 1 cleanup。

## W1 · h3-worker.ts:120 — 陈旧 worker 可删掉新 attempt 已提交的成片（数据丢失）
输出路径固定为 outputs/{job.id}.mp4：lease 过期的 worker A 晚到的下载会 rename 覆盖 worker B 已入库的文件，随后 A 的失败补偿 rm 把成片删掉。修法方向：输出文件路径带 lease/attempt 唯一后缀，finalize 时按 DB 内容寻址（hash 或 attempt id），补偿只删自己的临时文件。

## W2 · h3-worker.ts:99 — submit-once 窗口：提交成功但落库前崩溃 → 重复提交
修法方向：提交前先落"submit intent"（预写 client_id/幂等标记），恢复时先按 client_id 查 ComfyUI queue/history 认领已存在 task，找不到才重提交。

## W3 · comfyui-client.ts:79 — 轮询超时即永久失败，不打断 ComfyUI
12 分钟默认预算对长渲染不够；超时后 ComfyUI 还在渲染，产物成孤儿。修法方向：超时不等于失败——区分 H3_COMFY_TIMEOUT 为可恢复态（job 回 queued/timed_out 走重领续询）；超时/放弃时调用 /interrupt 或队列删除；预算按帧数动态放大。

## W4 · job-operations.ts:186 — ComfyUI 重启后 reclaim 死抱失效 task id
修法方向：poll 连续 N 次 history 为空（且 /queue 无此 id）→ 判定 task 蒸发，清 provider_job_id 允许重提交（与 W2 的认领逻辑配对，防误判）。

## W5 · h3-worker.ts:177 — 上传用 basename + overwrite=true，同名参考图静默合并
修法方向：上传文件名带 job id + slot 前缀（如 {job_id}-slot0-{basename}），graph 引用同名。

## W6 · h3-worker.ts:133 — cancel 不打断 ComfyUI 也不解除 worker 阻塞
修法方向：cancel 时若有 provider_job_id → POST /interrupt 或队列删除；poll 循环每轮检查 job 是否已取消（AbortSignal 贯通）。

## W7 · h3-worker.ts:123 — 空 error message 使 failH3Job 拒绝，job 卡在 live lease
修法方向：workerFailure 对空 message 填默认文本；fail 路径的二次异常也要把 job 置为失败（最后手段 direct SQL/宽松校验），不许静默留 claimed。

## W8 · comfyui-capabilities.ts:3 — REQUIRED_H3_NODES 与实际 graph 脱钩
修法方向：从三个 graph builder 导出各自 class_type 集合，capability 检查按 union 生成，单测断言 graph 节点 ⊆ 检查清单（防再次漂移）。

## W9 · h3-worker.ts:104 — 长渲染期间无心跳（PLAUSIBLE）
修法方向：poll 循环内周期 heartbeat（每 N 轮续租）；配置校验 poll 窗口 < lease 时长否则启动报错。

## W10 · 三个 graph builder 近全量复制（cleanup）
修法方向：抽公共 Director 骨架（LoRA 链、timeline、sampler、输出尾），各模式只声明差异（task 字符串、输入槽、loader）。顺带解决 W8。

## 另三路 review 结论（已过，无整改项）
架构 A-（依赖方向干净、行数合规）；协议对齐通过（docs/protocol.md 1.2 十章齐）；测试 A-（81 项、真机四段证据、恢复路径计数验证；浏览器自动化仍缺——环境限制）。
