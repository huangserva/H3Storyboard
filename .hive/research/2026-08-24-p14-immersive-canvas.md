# H3Storyboard P1.4 沉浸式画布索引

- 日期：2026-08-24
- 完整报告：[`../reports/2026-08-24-p14-immersive-canvas.html`](../reports/2026-08-24-p14-immersive-canvas.html)
- 分支：`codex/p0-p1-h3-canvas`
- 状态：实现、完整门禁和四路独立复核完成。

## 结论

P1.4 已实现两级画布能力：应用内专注模式与 Browser Fullscreen API。进入专注隐藏 Header、项目栏、资产栏和常驻 Inspector；节点详情改为抽屉。F/Esc、场景聚焦、全景、大媒体卡、窄窗布局、焦点归还与拒绝/并发状态均有真实浏览器覆盖。

旧 SQLite 画布新增显式 `update_layout_if_untouched` 一次性迁移，只更新从未被用户调整的行。Plan 卡预览改用最新非 rejected Take，与 QC 页脚保持一致。

声音继续执行硬边界：只有 `producer_job_id` 对应 H3 job 且 `audio_mode=h3_native` 的视频可播放声音。外部视频、silent Take 和无 producer job 视频统一经 `PolicyVideo` 强制静音；没有 TTS、配音、音乐、环境声或雨声。

## 最终验证

- `pnpm check`：通过。
- `pnpm build`：通过。
- Vitest：35 files，229 passed，1 skipped。
- Playwright：20 passed。
- 四路独立 review 最终评分：A `B`、B `B+`、C `B-`、D `A`；综合 `B+`。

## 明确未做

- 390px 手机触控专用体验。
- undo / multi-select。
- 100-shot 专注/全屏性能基准扩展（现有 100-shot 挂载、完整 minimap 与请求规模测试保留）。
- `StoryboardFlow.tsx` 当前 246/250 行；下一次扩展前拆 viewport controller。
