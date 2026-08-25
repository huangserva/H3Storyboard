# H3Storyboard M3A：批量编排研究索引

完整、自包含交付报告：

- [2026-08-25-m3-batch-orchestration.html](../reports/2026-08-25-m3-batch-orchestration.html)

## 结论

M3A 已实现持久化 worker 批量调度、跨任务进度策略和逐镜不可变重试。批次状态及进度由镜头当前任务实时推导；调度同时覆盖批次轮转、非批次任务与超时恢复；重试以唯一后继链保持审计和幂等性。

## 最终验证

- `pnpm check`：通过
- `pnpm build`：通过
- Vitest：43 个文件，268 通过，1 个既有可选 live ComfyUI 测试跳过
- Playwright Chrome：24 个 E2E 通过
- 四维 review：架构 B-、bug A-、测试 A、spec B+；综合 B+

## 关键实现入口

- 协议：`packages/protocol/src/h3-batch.ts`
- migrations：`apps/api/src/db/migration-v22.ts`、`apps/api/src/db/migration-v23.ts`
- 批次 store：`apps/api/src/store/h3-batch-operations.ts`
- 重试：`apps/api/src/store/h3-job-retry.ts`
- 公平领取：`apps/api/src/store/h3-job-claim.ts`
- Studio hook：`apps/studio/src/features/canvas/use-h3-job-batches.ts`
- Studio 展示：`apps/studio/src/features/canvas/BatchProgressDock.tsx`
- 后端集成：`tests/integration/m3-batch-orchestration.test.ts`、`tests/integration/h3-worker.test.ts`
- 画布 E2E：`tests/e2e/z-p15b-canvas.spec.ts`

## 边界与下一阶段

- 本轮未调用真实 4090；真实 worker 通过本地 stub provider 验证调度和 provider 恢复边界。
- 测试服务不启动 worker，避免误提交真实 H3 任务。
- M3B 仍包括 v2v / rv2v / 视频语义参考。
- M+1 应补批次分页或增量订阅、调度排序索引，并拆分接近项目行数上限的画布与 worker 文件。
- 音频约束保持为 H3 原生声音或静音，不接入 TTS、配音、音乐或环境音。
