# H3Storyboard P1.5A 场景导演画布索引

- 日期：2026-08-25
- 完整报告：[`../reports/2026-08-25-p15a-scene-director.html`](../reports/2026-08-25-p15a-scene-director.html)
- 分支：`codex/p0-p1-h3-canvas`
- 状态：实现、完整门禁、两轮四维独立复核完成。

## 结论

P1.5A 已把全图浏览改造成“总览导航 + 当前场景导演工作台”：顶部场景标签切换，当前场景按 References → Plan → H3 Actual/QC 三泳道展示。Plan 卡固定分离首帧、尾帧与最新 Take；支持 character target 和 `reference_target_state`。

场景机位按场保存，覆盖普通切场、快速切场、项目 rail 跳场、专注模式和 Browser Fullscreen。100 镜项目在纯函数中精确隔离 10 镜，在真实 Chrome 中投影 41 个当前场节点并保持可见节点裁剪。

Plan、Job、Asset、Take/QC 继续独立；声音规则没有改动，新增缩略视频全部 muted，没有 TTS、配音、音乐、环境声、雨声或音效。

## 最终验证

- `pnpm build`：通过。
- Vitest：36 files，238 passed，1 skipped（明确 opt-in live ComfyUI probe）。
- Playwright：22 passed，真 HTTP + SQLite + Chrome。
- Review 最终评分：A `B+`、B `A`、C `A-`、D `A`；综合 `A-`。

## 后续边界

- P1.5B：multi-select、拖拽绑定、批量任务。
- P1.5B 开工前先进一步拆分 `StoryboardFlow.tsx`；当前 247/250 行。
- 静态新增 Job → Asset → Take 后的浏览器实时刷新可继续增强，但不阻断 P1.5A；节点数变化已不再抢夺当前机位。
