# H3Storyboard P1.5B 批量生成与语义绑定索引

- 日期：2026-08-25
- 完整报告：[`../reports/2026-08-25-p15b-batch-binding.html`](../reports/2026-08-25-p15b-batch-binding.html)
- 分支：`codex/p0-p1-h3-canvas`
- 状态：实现、完整门禁、多轮四维独立复核完成。

## 结论

P1.5B 已把场景导演画布从只读血缘升级为生产入口：Plan 支持 Meta/Ctrl 多选和底部 batch bar；1–100 个 H3 Job 在一个 immediate SQLite transaction 内原子、幂等创建。客户端在响应丢失后会沿用精确 idempotency key，服务端也拒绝不同 key 为同镜创建第二个活跃 Job。

参考图、角色及 approved Take 的真实派生首尾帧可通过稳定 source/target handle 拖到 Plan。绑定只允许未锁项目并校验 project、kind、archive、Take QC、derivation、自引用和 continuity 组合；Plan、Job、Asset、Take 继续独立。协议和 health 已升至 1.8。

Studio 批量输入固定 `audio_mode=h3_native`，共享协议拒绝外部 audio binding。没有 TTS、配音、音乐、环境声、雨声或音效。专用 demo 视频仍为无音轨，并新增一张从 Take 01 真实提取的尾帧用于 continuity 拖拽测试。

## 最终验证

- `pnpm check && pnpm build && pnpm test`：通过。
- Vitest：41 files，252 passed，1 skipped（明确 opt-in live ComfyUI probe）。
- Playwright：24 passed，真 HTTP + SQLite + Chrome。
- Review：A 架构 `B-`、B bug `A`、C 测试 `B`、D spec `A`；综合 `B+`。

## 后续边界

- M3：worker-side batch scheduling、跨任务进度策略、逐镜 retry。
- P1.6 增量开发前继续拆 `StoryboardFlow` 的 28 props 与 243 行控制器，以及 299 行 `ProjectStore` facade。
- Ctrl/框选与百镜下 P1.5B 新交互可增加专门 E2E，但现有实现、真 Chrome 主路径与百镜回归均已通过。
