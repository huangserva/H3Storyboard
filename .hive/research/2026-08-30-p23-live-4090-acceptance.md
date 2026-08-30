# 4090 真实全链验收索引

交付报告：
[2026-08-30-p23-live-4090-acceptance.html](../reports/2026-08-30-p23-live-4090-acceptance.html)

## 结论

- H3Storyboard 线上项目 `上海雨夜 · 真实全链验收 2026-08-30` 已达到画布测试状态。
- 项目标识 `adcc5bcc-4e3e-4c1a-9c4b-ac48fe86ea57`。
- 公网入口 `http://106.14.227.192:9994`，Basic Authentication 认证有效。
- 真实链路已穿透：本地 Qwen3.8 27B 写作 → 质量门 → fresh-context 独立审阅 →
  锁定/编译/批准 → 角色首帧 → MiniMax H3 三任务批次 → QC → 代表成片 → 画布。

## 真实产物

- AI 剧本版本 `c4b3fef9-e5fc-43b0-bd28-7839fc482675`。
- 3 场、12 个动作节拍、估算 30 秒；首轮通过，无修复调用。
- 独立审阅 `approve_with_notes`，仅两条非阻断连续性建议。
- H3 任务：
  - `177e2696-17ab-4a18-a007-fc2e3cda9ba1`
  - `c4d49dfd-648d-4259-aa97-af75a4dd0517`
  - `3a6ce41a-d71c-41e2-8319-559d9ddd8a08`
- 三任务均首次成功；三条实际成片已 QC approved 且 representative approved。
- 每条 480×864、24 fps、3.75 秒、H.264；FFprobe 均只有视频流，无音频流。

## 人物一致性

- 三镜分别绑定三个已批准的 first-frame asset。
- 抽取每条开始/中间/末尾帧核对：同一张脸、约 42 岁、齐肩黑发、深青色长风衣、
  黑色内搭、黑鞋与黑伞保持。
- 场景动作分别为雨巷行走、门口取信、收信转身。
- 计划是 10 秒/场，本轮为 4 秒/镜真实快速验收；这一差异已写进实际成片 QC 记录。

## 生产配置

- Studio `5174`，API `4187`，公网隧道 `9994`。
- 角色图片 ComfyUI `8188`，H3 视频 ComfyUI `8190`。
- 文字模型 `Qwen3.8-27B-Q8_0.gguf`，CPU-only；服务端点 `8080/v1`。
- 图片、视频、文字模型和入口六项服务最终均为 active。
- H3 Job 的 `audio_mode` 为 `silent`；没有 TTS、配音、对白、音乐、环境声、雨声或音效。

## 实现与验证

- 生产代码 commit `c364427`：兼容 Qwen 前置空 reasoning wrapper，同时保持严格 JSON、
  schema 与尾随说明拒绝。
- commit `d12aa23`：文字模型传输改为 Node 原生 HTTP，绕开隐藏 response-header timeout。
- commit `69fd6ec`：请求 JSON object、Node timer 上限与相关回归。
- `pnpm check && pnpm build && pnpm test` 全过。
- Vitest 49 文件：312 passed / 1 skipped。
- Playwright Chromium：28 passed。
- 4 路独立最终审查：架构 B-、真实 bug B+、测试 A-、spec B+；无严重偏离。

## 下一里程碑

- 持久化的异步 AI generation task，支持断开取消、重启恢复、多 API 实例互斥。
- provider capability negotiation，避免强制 `response_format` 不兼容其他端点。
- 质量语义：验证 hook 内容兑现；`revise` 必须有明确阻断理由。
- 拆分超过 1000 行的 P2.3 集成测试文件。
- 若要交付最终短片，再把每镜扩展到计划 10 秒并进行剪辑；本轮目标是画布全链测试。
