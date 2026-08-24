# P1.3B 角色图真实执行闭环索引

- 日期：2026-08-24
- 完整报告：[`../reports/2026-08-24-p13b-character-image-execution.html`](../reports/2026-08-24-p13b-character-image-execution.html)
- 真实证据：
  - [`../evidence/p13b-character-image-smoke/result.json`](../evidence/p13b-character-image-smoke/result.json)
  - [`../evidence/p13b-character-image-smoke/derived-result.json`](../evidence/p13b-character-image-smoke/derived-result.json)
- 当前状态：P1.3B 实现、4090 三路径、全量门禁与四路独立复审均已完成；四个维度最终评分全部达到 B- 以上。

## 结论

此前没有直接把 4090 按钮塞进 P1.3，是因为当时还缺独立持久任务、submit intent、恢复、取消、GPU 互斥和原子资产登记；直接接 ComfyUI 会形成不可查询、不可恢复、可能重复提交的假产品链。用户在 2026-08-24 明确扩大范围后，P1.3B 已把这些前置条件与真实执行一起补齐。

## 已实现的闭环

1. `CharacterImageJob` 与 H3 视频任务分离；协议、事件和稳定错误码统一使用 snake_case。
2. migration v20 建立图片任务、事件、共享 GPU lease 和 `producer_image_job_id`；v21 约束一个原任务只能派生一个 immutable retry。
3. 三条确定性 graph：Krea2 母图 T2I、Qwen Image Edit 2511 身份编辑、Krea2 variant i2i。
4. API 支持 create/list/retry/cancel；engine/provider 由服务端按 operation 决定，客户端不能伪造；LoRA 默认禁用并受 allowlist 约束。
5. worker 持久化 `provider_client_id` submit intent，按 client id / prompt id 恢复原任务；轮询、heartbeat、指数退避、精确取消和进程 stop 均保留任务真相。
6. H3 video 与 character image 按 `gpu_host` 共用 SQLite lease；提交前后双查 8188/8190 队列，只对显式 managed endpoint 调 `/free`，再验证最小空闲显存。
7. 图片完整像素解码、临时文件与原子落盘；完成时在一个 SQLite transaction 中创建 candidate Asset、CharacterReference、可选 derivation 并完成 job；再次校验冻结来源未变化。
8. Studio 制片墙可创建三类任务、查看真实状态、只轮询活跃/可自动恢复任务、取消、重试、预览 candidate、人工批准并提示 manifest stale / 重新冻结。
9. 孤儿输出只移动到 quarantine，不静默删除用户文件。

## 4090 三路径证据

共同项目 `4586c44b-e866-4e04-a36a-517aefea4218`、角色 `818dc09b-7d15-4744-92b9-a215c48f804c`。三条输出均为 PNG、`completed` job 对应 `candidate` Asset，且 `lora_profile/lora_name/lora_strength` 全为 `null`。

| 路径 | Job / Comfy prompt | 模型与参数 | 请求尺寸 → 解码尺寸 | 输出 |
|---|---|---|---|---|
| Krea 母图 | `ee7fcec5-a0f3-4e71-8539-7f0fbe2ffae0` / `7141350c-a21c-4abe-950c-873914ff12e7` | `krea2_turbo_fp8`，8 steps，CFG 1，euler_ancestral / sgm_uniform，seed `2026082401` | 480×864 → 480×864 | Asset `dec6508d-183b-484c-b2bd-703032b18027`；SHA-256 `88f22f…cdc36` |
| Qwen 身份编辑 | `67e73b2b-d074-4c1b-80af-4556ce50e99a` / `4e3bd267-7f5e-48bc-a868-07e2d5ce3c48` | `qwen_image_edit_2511_fp8_lightning_4steps`，4 steps，CFG 1，euler / simple，denoise 1，seed `2026082402` | 480×864 → **752×1392** | Asset `b75b38a6-bfdb-4306-a85f-12717f1b03cd`；输出实际尺寸由 Qwen 的 `FluxKontextImageScale` 决定，UI 必须标“请求尺寸”而不能谎报输出尺寸 |
| Krea 轻派生 | `720c0b84-4f3e-436f-910a-4909f2a582b0` / `3300be32-9670-46cc-9352-0dc5e3daefca` | `krea2_turbo_fp8`，8 steps，CFG 1，euler_ancestral / sgm_uniform，denoise 0.52，seed `2026082403` | 480×864 → 480×864 | Asset `8c58b7d3-69ac-4052-b1ef-88040121963d`；来源锁定母图 hash |

母图 smoke 前 4090 报告约 9.47 GB free，worker 协调并释放显式 managed 模型后报告约 31.62 GB free；这是单次证据，不应推导为固定显存需求。

## 验证证据与当前闸门

- 协议/graph/图片解码/LoRA capability/GPU coordinator/worker 恢复与取消/janitor/form 均有 unit coverage。
- `packages/project-store/tests/character-image-job-store.test.ts` 覆盖 migration、状态机、retry、lease、来源与原子完成。
- `tests/integration/character-image-api.test.ts` 使用真 HTTP server + 真 SQLite，覆盖 idempotency、持久重启、服务端 engine、LoRA allowlist、scope/lock、cancel/retry。
- `tests/integration/production-start.test.ts` 启动编译后的 `apps/api/dist/main.js`，用真 HTTP + SQLite 穿透主进程 image worker，并覆盖运行中 provider prompt 的精确取消。
- Playwright 制片墙测试覆盖生成入口、参数默认、状态展示、candidate/批准与 manifest stale 交互。
- 真实 4090 smoke 不是 mock：两份 evidence 保存 job、provider prompt、资产、内容 hash、像素解码与 GPU snapshot。
- 最终完整 `pnpm check && pnpm build && pnpm test` 通过：Vitest 33 files，225 passed、1 个显式 opt-in probe skipped；Playwright 14 passed。此前一次 Playwright 在 Chrome `newContext` 启动阶段超时，完整重跑全绿，未出现产品断言失败。

## 声音边界

此能力只创建 `image` Asset，不读取、生成或混合任何声音。整个项目继续只允许 H3 原始输出内已有声音或静音；禁止 TTS、配音、声线克隆、音乐、环境声、雨声、room tone、Foley、SFX 和合成噪声。图片任务不改变 H3 job 已冻结的 `audio_mode`。

## 范围外

仍不属于 P1.3B：M3 的 v2v/rv2v 语义引用、视频/音频引用槽、批量镜头生成队列，以及任何新音频能力。旧项目的 fallback/placeholder 和同步 SSE 任务模型也不迁入 H3Storyboard。

## Self-Review

- A 架构与可维护性：**B+**。修复 H3 timeout 立即重领导致的自旋/饿死；拆出 `h3-job-claim.ts` 与两个 cancel 模块，所有服务文件 ≤300 行；managed endpoint、双队列复查及同 endpoint 去重均关闭。
- B 真实 bug 与边界：**B-**。全阶段 provider I/O 使用 abort signal；心跳严格 GPU→job，失租即中止旧 I/O；active/inactive cancel 都在 GPU lease 内执行并有 30 秒安全 deadline；submit intent 用 3 次 queue/history 确认。
- C 测试质量：**B-**。真 HTTP+SQLite 双 worker、编译后 runtime、浏览器 completed→candidate→approve→reload、恢复/取消/退避竞态均已穿透；未发现生产测试 fallback 或 PTY mock。
- D spec / protocol 对齐：**B**。API 无 worker 时拒绝假取消；`error_code` 收紧为稳定枚举；Qwen 可用 approved derived source，但输出血缘递归回到 canonical root；snake_case、migration v20/v21、声音禁令和 M3 边界保持一致。

严重项 verdict：第一轮所有严重项均已修。具体包括 H3 无退避饿死、文件超限、非 poll I/O 失租双主、取消提前释放 GPU、API 只改本地状态却未停 provider，以及 submit-intent cancel 竞态；对应回归测试和最终全量门禁均通过。

保留的中低风险及裁决：角色图列表 2 秒轮询存在 N+1，当前任务规模可接受，待做分页/summary API 时合并优化；ComfyUI running cancel 只能调用上游全局 `/interrupt`，已用 durable GPU lease、目标队列核验和 managed 边界降低风险，但非协作外部进程仍有 TOCTOU；H3 timed-out 取消仍消耗一次 attempt、双 worker 穿透只验证 H3 owner→image loser、v20 未给错误码加 SQL CHECK、janitor rename failure 未故障注入。这些不改变 P1.3B 的角色图闭环，分别属于既有 H3 lifecycle hardening、规模性能或防御性测试增强。

综合评分：**B**。首轮 A/B/C/D 均曾出现 C/C+ 阻塞；三轮整改后为 **B+ / B- / B- / B**，满足交付门槛。
