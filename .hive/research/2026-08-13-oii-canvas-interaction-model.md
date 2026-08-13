# OiiOii 画布交互模型与 H3Storyboard 直接操作化索引

- 日期：2026-08-13
- 完整报告：[`../reports/2026-08-13-oii-canvas-interaction-model.html`](../reports/2026-08-13-oii-canvas-interaction-model.html)
- 研究范围：只读源码调研；未修改 `apps/`、`packages/` 或外部仓库
- 结论置信度：高（本地仓库已 `git pull --ff-only`，并逐段核对前端模板、状态方法、API、SQLite 写入顺序）

## 0. 先验核验：哪个仓库有画布

| 仓库 | 拉取结果 | HEAD | 画布证据 | 判定 |
|---|---|---|---|---|
| `git@github.com:huangserva/xyz-video-creator.git` | `Already up to date` | `67d11bf34a4c309c07287602065c48d44d7fa522` | `frontend/oii.html` 4712 行、`frontend/oii-app.js` 5778 行、`frontend/oii-styles.css` 1011 行；`backend/oii/routers/project_router.py:425-468` 有 canvas-node API | OiiOii UI/画布事实源 |
| `https://github.com/huangserva/xyz-video-skill` | `Already up to date` | `06837a0353d8efa8cad990869a85a6e7426f11f7` | 顶层只有 `scripts/`、`templates/`、`docs/`、`models/`、示例 JSON；无 HTML/JS/TS/CSS 或前端目录 | 纯 Python 视频管线，不含画布 |

## 1. 最重要的纠偏：OiiOii 好用，不等于它是完整 node editor

OiiOii 当前可见的 `free` 画布由一个可 pan/zoom 的 `canvasContent` 包住固定纵向工作流：编剧卡、角色横排、场景、分镜网格和合成区（`frontend/oii.html:2612-2629`, `2754-2872`, `2978-3215`, `3708-3717`）。页面没有任何 `x-for="node in canvasNodes"`、`selectNode`、`startDragNode` 或 `zoomToNode` 绑定。

与此同时，JS 和后端确实保留了另一套未接通的 node 模型：

- 状态含 `canvasNodes` / `selectedNode`（`frontend/oii-app.js:240-241`），项目加载时接收 `canvas_nodes`（`frontend/oii-app.js:602`）。
- `ensureCanvasNodes` 为 character/storyboard 建记录，默认 3 列/4 列布局（`frontend/oii-app.js:5290-5366`）。
- 选中、拖拽、z-index、聚焦、位置保存方法存在（`frontend/oii-app.js:5379-5456`, `5552-5573`, `5606-5620`）。
- 数据表和 CRUD 存在（`backend/oii/database.py:410-440`, `1099-1215`; `backend/oii/routers/project_router.py:425-468`）。

因此它实际领先 H3Storyboard 的不是框选/连线能力，而是**业务卡片上的就地动作密度**：生成、重做、上传、编辑、媒体查看、状态遮罩、日志和下一步门槛都在对象旁边。H3 的改造应搬这种“直接操作化”，不能把 OiiOii 未接通的遗留 node 方法误报成已交付交互。

## 2. 五问逐答

### 2.1 节点/卡片上直接能做什么

#### 角色卡

- 头部直接编辑、全屏、删除（`frontend/oii.html:2762-2773`）；但 `toggleFullscreen` 实际只是“开发中” alert（`frontend/oii-app.js:2894-2897`）。
- 主形象、设定图位直接显示当前图片；点击媒体打开 lightbox，hover 显示生成/重做与上传（`frontend/oii.html:2776-2814`）。
- 特写视频 hover 预播，点击放大；同位提供生成/重做和创建 Sora 角色（`frontend/oii.html:2816-2852`）。
- 底部工具栏提供引用、重做、导出、保存角色库（`frontend/oii.html:2856-2862`）。
- 图片模型在 modal 中选择，而不是把完整参数塞进卡片（`frontend/oii.html:4554-4612`）。这是值得迁移的“主动作在节点、复杂参数渐进展开”。

#### 分镜卡

- 卡头直接编辑描述、删除；卡内直接选择场景和场景图（`frontend/oii.html:3016-3050`）。
- 同卡并列呈现首帧/拼接板、尾帧、视频；无结果时原位显示生成入口，有结果时 hover 显示放大/重做，生成中覆盖 spinner（`frontend/oii.html:3052-3185`）。
- 视频必须先有对应首帧，按钮直接显示“需首帧”并 disabled（`frontend/oii.html:3172-3179`）。
- 卡底直接配音、试听、合成（`frontend/oii.html:3187-3212`）。
- `zoomToImage` / `zoomToVideo` 只切换 lightbox URL（`frontend/oii-app.js:3483-3499`）；图片/视频 modal 在 `frontend/oii.html:3914-3938`。

#### SSE 日志

- API 以 `data: {type: log|result|error}` 输出 `text/event-stream`；例如角色主图（`backend/oii/routers/generate_router.py:33-84`）和视频（`backend/oii/routers/video_router.py:564-587`）。
- 前端用 `fetch()` 读取 `response.body`，日志推入全局 `generating.logs`，result/error 交给动作回调（`frontend/oii-app.js:5210-5238`）。日志弹窗在 `frontend/oii.html:3941-3958`，卡片自身通常只显示 spinner。
- 这不是 `EventSource`；parser 直接逐 chunk `split('\n')`，没有跨 chunk buffer（`frontend/oii-app.js:5212-5237`），不可原样搬。

#### 选中、inspector、双击、右键

- JS 有单选 toggle `selectedNode`（`frontend/oii-app.js:5379-5382`），但 HTML 未绑定，当前可见画布没有 node 选中态或 inspector。
- 全仓无 `dblclick` / `contextmenu` 绑定；无右键菜单。媒体是单击 lightbox，文本是单击编辑。
- `zoomToNode` 存在但未被 HTML 调用（`frontend/oii-app.js:5417-5456`）。
- H3Storyboard 反而已有单击选中 shot 和双击聚焦（`apps/studio/src/components/InfiniteCanvas.tsx:117-138`, `178-196`）。

### 2.2 节点类型、承载内容和同步时机

OiiOii schema 声明 `character | storyboard | script | note`（`backend/oii/models.py:597-637`），实际 auto-create 只创建 character/storyboard（`frontend/oii-app.js:5290-5366`）。`ref_id` 只是实体引用，node 表仅存布局，不承载业务结果（`backend/oii/database.py:412-426`）。

- character 实体承载描述、主图、设定图、参考图、服装、特写视频/Sora 名称等；卡片直接读写这些字段。
- storyboard 同时承载规划描述和生成结果：`first_frame`、`keyframe_first`、`keyframe_last`、`video_url`、`audio_url`、`final_video_url` 与 status 都在同一对象（`backend/oii/models.py:497-521`）。这正是不能搬的语义。
- 前端编辑分镜遵循“HTTP 成功后改本地对象”（`frontend/oii-app.js:2851-2868`），但生成端点并不一致：角色主图先把 result yield 给浏览器，再更新 DB（`backend/oii/routers/generate_router.py:73-79`）；普通视频也先 yield result，再更新 storyboard（`backend/oii/routers/video_router.py:564-572`）；keyframe 视频则先 DB update 后 yield result（`backend/oii/routers/keyframe_router.py:214-226`）。

结论：OiiOii 的“回填”是直接变更同一实体字段，而且部分路径可能短暂出现 UI 已成功、DB 尚未落盘。H3 必须坚持 `job -> canonical asset -> append shot_actual(pending)`，再更新 UI projection；绝不能把 URL 写回 `shot_plan`。

### 2.3 整体画布交互与 suggestion 流

#### 已实际接通

- 背景左键（排除 button/input/textarea/select/a/contenteditable）或中键 pan；滚轮以指针为中心缩放，范围 0.2–3（`frontend/oii-app.js:5511-5549`）。
- 右下角重置、fit、缩小、百分比、放大工具条（`frontend/oii.html:3710-3717`）。
- 卡片内的生成/编辑/选择/媒体动作，见 2.1。

#### 没有实际接通

- 无框选、多选、对齐/分布、节点连线、edge schema、右键菜单、快捷键动作集、minimap。
- 空格键状态被记录（`frontend/oii-app.js:5581-5597`），但当前 pan 条件并未读取 `spacePressed`（`5535-5549`），不是可靠的“空格拖画布”。
- CSS 中出现 `.connection-line` 不等于存在边模型或连接交互。

#### suggestion

1. 聊天 SSE 完成时后端按格式标记检测 `script` / `character` / `storyboard` suggestion（`backend/oii/routers/chat_router.py:175-207`, `238-269`）。
2. 聊天消息旁显示“应用剧本/角色/分镜”按钮（`frontend/oii.html:1379-1389`）。
3. 点击 `POST /projects/{project_id}/apply-suggestion`，后端解析文本并直接 create/update 实体（`backend/oii/routers/chat_router.py:275-338`, `598-646`, `649-720`）。剧本覆盖会先要求确认（`295-321`）。
4. 前端收到成功后刷新/追加状态（`frontend/oii-app.js:1995-2126`），但 suggestion 不是直接拖入画布，也没有 diff/patch preview。

H3 适配应把 suggestion 变成**待审草稿补丁**：先展示将新增/修改的 planned 字段与引用绑定，再由用户显式应用；生成结果绝不经 suggestion 写入。

### 2.4 哪些不能搬，以及协议适配

| OiiOii 行为 | 冲突 | H3 适配 |
|---|---|---|
| 生成 URL 写回 storyboard/character 当前字段 | planned/actual 混合；旧结果被新值遮蔽 | 生成只建不可变 `h3_job`、asset、`shot_actual(pending)`；卡片派生展示 take，不改 `shot_plan` |
| “重做”直接再次生成并替换当前预览 | 违反 append-only take；重复 job 有 take gate | 文案改“新建 Take”；通过 `TAKE_GATE_BLOCKED`，需要 approved representative 或显式 override reason |
| 卡片按钮只按 `first_frame` 是否存在启用 | 绕过 manifest、mode capability、binding compiler、generation lock | 按钮状态来自 server preflight/compile：brief、manifest、lock、mode、bindings、gate 全部通过才可提交 |
| result SSE 到达即本地回填成功 | DB 可能尚未提交，违反 DB-before-projection | 服务端先事务落盘 asset/actual/job，再发可消费完成事件；客户端随后刷新权威 snapshot |
| 角色/场景 URL 直接进入 prompt | 可能声称了未上传引用，违反统一 binding list | 卡片只能选择 approved canonical asset；prompt 展示必须由 compiled bindings 派生 |
| suggestion 直接 create/update/overwrite | 可能无审计地改计划；生成锁期间更危险 | suggestion -> typed draft patch -> diff -> confirm -> stable-code API；锁中拒绝 production-context 变更 |
| 删除分镜/角色按钮原位执行 | H3 项目/资产 append-only 默认 | 默认 archive/supersede；物理删除另走显式确认且不列入首期画布动作 |
| 全局 `generating` 单槽日志 | 多 job 并发时互相覆盖 | 按 `job_id` 建独立进度 capsule/timeline；状态来自持久 job/job_events |
| 任意连线（若未来实现） | 视觉 edge 可能伪造引用/连续性 | 只允许创建协议支持的 semantic reference/continuity dependency；校验成功后才画实线 |

### 2.5 H3Storyboard 现状差距

H3 当前基础已经强于 OiiOii 的“画布壳”：

- 真正按节点渲染和拖拽，pointer capture、pan、wheel zoom、双击聚焦（`apps/studio/src/components/InfiniteCanvas.tsx:117-185`）。
- scene 动态分组框、shot 和 character 共画布（`apps/studio/src/components/InfiniteCanvas.tsx:98-115`, `208-226`）。
- SQLite `canvas_nodes` 严格校验 ref/project/duplicate，使用 `crypto.randomUUID()`（`packages/project-store/src/canvas-operations.ts:37-107`）。
- 分镜卡已有 actual/first-frame 预览、compile-ready 和 take verdict（`apps/studio/src/components/CanvasShotCard.tsx:21-68`）。
- planned/actual、QC、generation lock、take gate 已是持久协议（`packages/project-store/src/generation-locks.ts:21-79`; `job-operations.ts:24-108`, `125-135`; `shot-operations.ts:234-279`）。

核心差距不是更“无限”，而是节点几乎只读：shot 卡没有生成/新 Take、输入修复、take 切换/QC、放大播放、上下文动作；character 卡只显示 monogram，没有参考图或直接编辑（`apps/studio/src/components/CanvasShotCard.tsx:37-70`; `CanvasCharacterCard.tsx:12-27`）。选中 shot 后 inspector 只在“计划/实测”视图出现，画布视图未提供对象级 inspector（`apps/studio/src/components/DirectorWorkspace.tsx:97-115`）。

另一个实现风险：节点拖动先 optimistic 更新内存，再异步保存（`InfiniteCanvas.tsx:151-166`; `use-canvas-nodes.ts:97-115`）；保存失败只报错、不回滚。后续批量对齐/多选前应明确 authoritative rollback/reload，避免布局 projection 与 SQLite 漂移。

## 3. 推荐改造模型

### 交互骨架

`单击节点 -> 选中 + 右侧 inspector`；`节点 hover -> 只出现 1 个主动作 + ⋯`；`双击媒体 -> lightbox`；`双击卡片非媒体 -> 聚焦`；`右键/⋯ -> 次要动作`。生成不是“覆盖预览”，而是沿着以下链路：

`preflight -> create immutable job -> per-job progress -> persist asset + pending actual -> card adds TAKE N -> explicit QC -> optional representative approval`。

### P0（先让用户在画布完成单镜闭环，约 8–12 工程日）

1. **分镜节点主动作条：生成 / 新建 Take / 修复输入**（2–3d）。状态由 server preflight 决定；禁止只靠前端 `compileReady` 猜测。错误按稳定 code 显示下一步：`LOCK_REQUIRED`、`MANIFEST_REQUIRED`、binding 错误、`TAKE_GATE_BLOCKED`。
2. **画布内 inspector**（2–3d）。选中 shot 后同视图呈现 planned 摘要、compiled binding 清单、最新 job、take 列表；复杂编辑继续用现有 modal，避免卡片膨胀。
3. **卡内媒体与 take switcher**（2–3d）。默认展示“最新非 rejected”但明确标 `TAKE N · pending/approved/rejected`；点击放大播放，绝不把 actual 伪装成已批准计划结果。
4. **按 job 的进度 capsule + 持久时间线**（2–3d）。先用 snapshot polling；如补流式端点，事件必须由已提交的 job/job_events 派生，完成事件在 DB transaction 后发送。不要照抄 OiiOii 的 chunk parser/global log slot。
5. **P0 真 HTTP + SQLite 集成测试**（并入上述估时）。跨越按钮提交、锁/门禁错误、完成后 append actual、刷新后 take 仍在且 plan 未变。

### P1（提升批量导演效率，约 8–13 工程日）

1. **角色节点直接操作**（2–3d）：缩略图、参考资产管理、编辑 canonical appearance；只允许 approved canonical asset 进入 binding。生成角色图若尚无正式 provider contract，不伪造入口。
2. **框选/Shift 多选 + 批量生成 preflight**（3–5d）：每镜独立 job、独立 gate/error；部分失败不回滚已创建 job，也不把组视为单一 take。
3. **右键/⋯ 与快捷键层**（1–2d）：聚焦、打开 inspector、复制计划为新计划、archive/supersede；危险动作不进入默认菜单。
4. **Suggestion 草稿收件箱**（2–3d）：`script/character/storyboard` 结构化成 typed patch，在画布预览新增/变化节点，确认后应用；生成锁中稳定拒绝。

### P2（组织复杂画布，约 7–12 工程日）

1. **对齐/分布/fit selection + 批量布局 API**（2–4d）：单事务持久化，再替换本地 projection；失败整体回滚/重载。
2. **协议语义连线**（3–5d）：只显示/编辑 character reference、first/last frame、approved take continuity；draft edge 与 validated edge 样式分离。
3. **minimap、折叠 scene、保存视口/selection**（2–3d）：属于规模化导航，不抢 P0。

## 4. 建议验收标准

1. 用户不离开画布即可：选镜 -> 看缺什么 -> 提交 -> 看进度 -> 打开新 Take -> QC。
2. 任意生成完成前后 `shot_plan` 行字节级不变；只 append job/asset/actual/event。
3. pending/rejected take 永不显示为“批准结果”；代表 Take gate 与 QC verdict 分别可见。
4. 提示词显示的媒体引用与上传/compiled binding 列表完全一致。
5. 刷新页面后动作、进度和结果仍由 SQLite 恢复；断流不等于任务失败。
6. 至少一条真实 HTTP + SQLite 集成测试覆盖成功路径，并覆盖锁、binding、take gate 三类稳定错误。

## 5. 调研边界与风险

- 没有启动 OiiOii 服务进行浏览器 E2E；交互结论来自已拉最新的模板、JS、API 和测试静态交叉核验。是否“可见/接通”的判断以模板绑定为准。
- OiiOii 当前 HEAD 早于 xyz-video-skill HEAD，但两仓都已 fast-forward 到各自远端最新可见提交。
- 另一 worker 正在实现 Studio 生成按钮；本调研未读取其未提交设计假设，也未修改任何 Studio 代码。P0 应在其交付后做一次契约去重。
