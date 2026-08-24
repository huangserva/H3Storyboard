# P1.2 可直接测试画布索引

- 日期：2026-08-24
- 完整交付报告：[`../reports/2026-08-24-p12-canvas-test-ready.html`](../reports/2026-08-24-p12-canvas-test-ready.html)
- 分支：`codex/p0-p1-h3-canvas`
- 实施基线：P1.1 commit `68c800e`
- 产品主线：线上 `huangserva/H3Storyboard`

## 目标

把 P1/P1.1 的结构画布推进到用户可直接体验：无需 4090，打开本地网页即可看到真实角色参考、真实可解码视频、`ShotPlan -> H3Job -> output Asset -> ShotActual/Take` 精确血缘，并能切换 Take、做 QC 与代表片审批。任何演示声音必须为静音；不允许 TTS、配音、音乐、雨声、环境声或音效。

## 实施结论

1. `pnpm demo:canvas` 幂等创建独立 `.h3storyboard/canvas-test.db`。Seeder 使用真实 ProjectStore 状态迁移建立 3 个计划镜头、2 个角色、2 个 completed Job 和 2 个独立 Take，不在 production API/Studio 中增加 demo fallback。
2. 两张角色图以 approved CharacterReference 进入画布；两段 480×864、10.125 秒 MP4 在安装前必须包含 video handler 且不含 audio handler，浏览器 E2E 再验证真实解码。
3. 画布卡片与 Inspector 支持图片/视频 lightbox、Take 切换、QC、代表 Take 与批准开闸；Job 和 output Asset 严格只解析到各自 Take，计划分镜在所有操作前后保持不变。
4. ProjectRail 每次点击都可重新聚焦同一镜头；拖拽 PATCH 未完成时的聚焦请求会排队，在保存结束后重放，不与持久化位置竞争。
5. 媒体端点用 canonical realpath 限制项目数据目录，断开响应会 unpipe/destroy ReadStream；测试直接观测文件描述符不泄漏。
6. Demo seed 忽略继承的 `H3_STORYBOARD_DB`，仅读取专用 `H3_CANVAS_DEMO_DB`；启动显式设置 `H3_WORKER=0`。真实 production entrypoint + ComfyUI sentinel 证明离线 demo job 不会触发任何 provider 请求。

## 验证

- `pnpm check`：通过。
- `pnpm build`：通过；保留 540.87 kB production chunk warning。
- Vitest：19 files，133 passed / 1 skipped。
- Playwright：8 passed；覆盖真实图片/MP4 解码、两组 Job/Asset/Take 血缘、QC/代表片刷新、拖拽保存中 refocus、100 Shot。
- 媒体回归：Range 206、路径穿越、symlink 逃逸、中断流文件描述符释放。
- Seed 回归：并发/重复幂等、用户新增 Shot 保留、残缺活动库拒绝且不删除、媒体失败事务回滚、禁音轨、写入 symlink 逃逸拒绝。

## Self-Review

- A 架构 B+：媒体/Take 组件已拆；保留角色 reference N+1、`storyboard-graph.ts` 249/250 行、`ProjectStore` 299/300 行，要求 P1.3 先拆/批量化。
- B bug/边界 B+：环境变量污染、残缺库删除、错误 lineage、媒体 FD/symlink、时长、拖拽聚焦、额外 Shot 与排序问题均修；保留 stale-lock TOCTOU、轻量 MP4 handler 扫描与 kill -9 孤儿媒体低风险。
- C 测试 B+（首轮 C+）：abort 直接观测 FD；两组血缘逐一解码；新增 drag-pending focus；fixture 移至 unit；错误断言改稳定 `CANVAS_DEMO_*` code。剩余 candidate/archived、REJECT、409/500 UI 恢复无浏览器用例。
- D 协议 A-：Exact Take→Job 与 worker 默认行为文档漂移已修；Plan/Actual、H3-only audio、worker-off、血缘均闭环。仅保留 demo stale-lock TOCTOU。
- 严重项 verdict：四路最终均无严重项、无 M+1 blocker；综合 B+。

## 明确保留

- P1.3 前先增加项目级 character reference batch API，并拆分 graph builder；不得继续向 249 行文件叠加节点类型。
- Demo stale-lock 若未来复用到生产流程，必须改成 owner token/条件释放；当前仅保护专用 demo 库，SQLite immediate 是最终一致性兜底。
- MP4 seed 校验是轻量 container handler 检查，不是完整 demux；浏览器 E2E 已证明当前两条 fixture 可解码。
- candidate/archived reference 过滤、QC REJECT、409/500 UI 恢复应在 P1.3 补浏览器覆盖；底层状态与 HTTP 错误已有测试。
- 本轮不访问 4090、不生成新视频、不新增 TTS/BGM/雨声/环境声/音效，也不修改任何线上或用户生产数据库。

## 下一阶段

在本地画布体验反馈基础上进入 P1.3：吸收 `xyz-video-creator` 的高密度角色卡、场景资产带和分镜墙展示，但继续以 H3Storyboard 的 Protocol/SQLite/Job/Take 为唯一真相，不复制 xyz 的计划结果混写、SSE 任务或声音路径。
