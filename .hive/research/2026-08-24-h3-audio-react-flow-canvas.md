# H3 原声硬约束与 React Flow 画布实施索引

- 日期：2026-08-24
- 完整交付报告：[`../reports/2026-08-24-h3-audio-react-flow-canvas.html`](../reports/2026-08-24-h3-audio-react-flow-canvas.html)
- 实施基线：线上最新 `H3Storyboard`，基线提交 `5b8c33b4c282d880f232412a14061d595be68fa9`
- 实施分支：`codex/p0-p1-h3-canvas`
- 参考研究：[`2026-08-13-oii-canvas-interaction-model.md`](2026-08-13-oii-canvas-interaction-model.md)、[`2026-08-11-xyz-oii-canvas-comparison.md`](2026-08-11-xyz-oii-canvas-comparison.md)

## 问题

1. 线上 H3Storyboard 缺少“最终音轨只能是 H3 原生输出或静音”的持久协议，历史 schema 仍允许 audio asset/binding。
2. 旧 InfiniteCanvas 是手写平移缩放与绝对定位，只显示 Shot/Character，无法呈现 Script、Scene、Asset、H3 Job、Output、Take/QC 的可追溯关系。
3. 不能直接复制 xyz/OiiOii：其媒体卡体验好，但计划与结果混在同一实体、生成任务不可恢复，并含 TTS/BGM/混音路径。

## 实施结论

- 线上 H3Storyboard 继续作为唯一产品基线；不合并旧仓库历史。
- Protocol 1.4 / schema v16 新增不可变 `audio_mode = h3_native | silent`。新 Shot 和所有 Job 拒绝外部 audio binding；worker 只按任务字段决定是否把 H3 音频接入输出。
- React Flow 只是 SQLite/ProjectSnapshot 的 projection，不是第二套业务状态。业务血缘严格为 `ShotPlan -> H3Job -> output Asset -> ShotActual/QC`，continuity 指向精确 source Take 与 reference frame asset。
- 只持久化 Shot/Character 锚点坐标；Script/Scene/Asset/Job/Take 节点和全部 edge 都从权威数据派生。
- 拖拽采用 per-node serial queue；失败立即回滚。大画布请求并发限 6，派生图索引改为线性构建。

## 关键验证

- Vitest：118 passed，1 skipped（唯一 skip 是外部真实 ComfyUI contract）。
- Playwright：4 passed，覆盖真 API + 真 SQLite + 真 Chrome 的画布挂载、Inspector、拖拽 PATCH、刷新回显、404 回滚和 100 Shot MiniMap。
- 音频：HTTP→SQLite→restart 的 silent 持久化；i2v/fl2v/r2v worker 都验证 silent 输出不含 audio track；外部音频 Job/新 Shot 均验证拒绝且不落库。
- 图谱：多 Job/Take 排序、Output Asset、精确 continuity、孤儿数据无悬空 edge、全前景节点无默认碰撞。

## 明确未做

- 未删除历史 audio asset/role schema；它们只用于兼容读取，不能进入新任务。
- 未建立批量 canvas upsert / batch preflight API；当前限制并发但请求数量仍为 O(Shot)。
- 浏览器 E2E 尚未用真实媒体 fixture 点击 Character/Asset/Job/Take/视频预览；相关血缘已有纯模型与 worker/API 集成覆盖。
- 未迁入 xyz 的 TTS、配音、BGM、环境声、SFX、结果覆盖 ShotPlan 或不可恢复 SSE task。

## 下一阶段

1. 增加 batch preflight 与幂等 canvas upsert，解决远端 4090 / 多标签页下的请求量与冲突。
2. 增加带真实媒体、Character、Job、Take 的浏览器 E2E，并覆盖远端节点导航和缩放交互。
3. 继续迁移 xyz 的卡内直接操作：媒体 lightbox、Take switcher、per-job progress；仍坚持 Plan/Actual 与 H3-only audio 约束。
