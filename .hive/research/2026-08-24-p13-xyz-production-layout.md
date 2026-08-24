# P1.3 · xyz production canvas 高密度布局迁移索引

- 日期：2026-08-24
- 完整报告：[`../reports/2026-08-24-p13-xyz-production-layout.html`](../reports/2026-08-24-p13-xyz-production-layout.html)
- 源仓库：`/Users/serva/development/xyz-video-creator`，检视 commit `67d11bf34a4c309c07287602065c48d44d7fa522`
- 目标仓库：H3Storyboard，检视 commit `194c38d425448b0ab817f5b87e327f61979b2419`
- 调研方式：只读源码静态交叉核验；未启动 xyz 服务，未修改任何生产代码
- 本报告范围：P1.3 视觉/信息架构、组件投影、响应式、可访问性与 100 Shot 验收；不设计新音频或生成后端

## 一句话结论

P1.3 应在 H3Storyboard 新增一个默认的 **“制片墙 / Production Board”**，吸收 xyz 的角色大卡、场景资产横带、三列分镜墙、卡内媒体与渐进动作；现有 React Flow 保留为 **“血缘流程 / Lineage Flow”**。两者只是同一份 H3 Protocol/SQLite 真相的不同投影，绝不复制 xyz 把计划与结果写进同一 storyboard、全局 SSE 任务槽、TTS/BGM/配音/环境声路径。

## 1. xyz 当前界面的准确事实

### 1.1 它的“自由画布”本质是可 pan/zoom 的固定生产墙

- 可见 `free` 视图用一个 `canvasContent` 包住纵向排列的业务区块，整体做 transform；不是 React Flow，也没有把可见卡片绑定到 `canvasNodes`：`frontend/oii.html:2612-2629`。
- JS 确有 `canvasNodes`、`selectedNode`、pan/zoom 状态和遗留拖拽方法：`frontend/oii-app.js:239-260`, `5396-5578`；但可见模板的角色、场景与分镜按固定 DOM 区块渲染。
- 这解释了它为何“看起来更完整”：优势不是图算法，而是生产对象旁的信息与动作非常密。

### 1.2 角色大卡：主图、设定图、媒体动作同屏

- 角色横向区域及卡头：`frontend/oii.html:2754-2773`。
- 主形象与设定图并排，媒体点击放大，hover 出现生成/重做/上传：`frontend/oii.html:2776-2814`。
- 特写视频 hover 预播及同位动作：`frontend/oii.html:2816-2852`。
- 底部工具条放引用、重做、导出、角色库：`frontend/oii.html:2856-2862`。
- 尺寸证据：竖图槽 `130×231`，宽设定图 `440×231`，hover 遮罩用底部渐变：`frontend/oii-styles.css:452-539`。

**可迁移原则：**一张大卡回答“这个人是谁、哪张是 approved 母图、有哪些派生参考、下一步能做什么”。复杂参数放 modal/drawer；卡内只留一项主动作和 `⋯`。

### 1.3 场景资产带：按场景聚合、横向浏览

- 场景容器的名称、分镜计数、添加/编辑动作：`frontend/oii.html:2874-2905`。
- 每个场景的 16:9 图片以横向滚动带呈现，卡片内 hover 放大/重做/删除，尾部为添加槽：`frontend/oii.html:2906-2950`。

**可迁移原则：**“场景”是聚合标题，“资产”仍是独立实体。H3 P1.3 不需要先引入 Scene 表；可按 `ShotPlan.scene_id` 分组，并聚合该场景镜头声明的 `reference_stage` / `role=scene` approved Asset。

### 1.4 三列分镜墙：计划摘要 + 媒体槽 + 状态动作

- 固定三列：`frontend/oii.html:3014-3017`。
- 卡头有镜号、编辑/删除，正文两行描述与场景选择：`frontend/oii.html:3018-3050`。
- 首帧/拼接板槽：有图时点击放大、hover 重做；无图时原位生成；生成中同位遮罩：`frontend/oii.html:3052-3110`。
- 视频槽：点击放大，hover 重做，生成中遮罩；没有输入时直接说明“需首帧”：`frontend/oii.html:3132-3184`。

**可迁移原则：**空槽显示下一步，结果槽显示真实媒体，状态贴近媒体。但 H3 文案必须是“新建 Take”，不能是覆盖式“重做”；卡片必须明确分成 `PLAN` 与 `LATEST TAKE` 两块。

### 1.5 流程视图：可借导航形态，不借其生产语义

- 顶部自由/流程切换：`frontend/oii.html:1111-1120`。
- 流程视图有横向阶段条与阶段进度：`frontend/oii.html:1492-1544`，右侧按当前阶段展示工作区：`frontend/oii.html:1546-1569`。
- 其中 `voices`、`audio`、`final` 等阶段直接暴露了 xyz 的配音/合成产品线：`frontend/oii.html:1520-1530`，不得迁入。

**可迁移原则：**借“多视图切换 + 当前阶段概览”，不借手工 `completeStage`。H3 流程状态只能从已持久化的 Brief/Manifest/Shot/Job/Take/QC 推导。

## 2. P1.3 目标信息架构

工作区顶部统一为三种互补视图：

1. **制片墙（默认）**：角色大卡 → 场景资产带 → 按场景分组的三列分镜墙；适合日常生产和批量审片。
2. **血缘流程**：保留现有 React Flow，展示 Script → Scene → Reference/Character → ShotPlan → H3Job → output Asset → ShotActual/Take/QC；适合追责与排错。
3. **计划 / 实测**：保留当前单镜比较页，做精细编辑与导演判定。

建议视图状态由 `DirectorWorkspace` 扩展为 `board | flow | director`。现有入口位于 `apps/studio/src/components/DirectorWorkspace.tsx:47-52, 88-138`；不要在 `InfiniteCanvas` 内再塞第二套大墙。

### 2.1 制片墙分区

```text
┌ 项目状态条：Brief / Manifest / 角色 / 镜头 / Job / QC 推导计数 ┐
├ CAST BIBLE ── [角色大卡][角色大卡][+ 添加角色] →              ┤
├ SCENE 01 · 上海雨夜 ── [场景资产][场景资产][+ 登记资产] →    ┤
│ [SHOT 01 PLAN | LATEST TAKE] [SHOT 02 ...] [SHOT 03 ...]       │
│ [SHOT 04 ...]              [SHOT 05 ...] [SHOT 06 ...]         │
├ SCENE 02 · ...                                                  ┤
│ ...                                                             │
└ Inspector：桌面常驻 / 中屏抽屉 / 小屏 bottom sheet             ┘
```

### 2.2 角色大卡

- 左侧：approved 主参考图，9:16；若没有 approved 图，显示可理解的空槽。
- 右侧：角色名、candidate/approved/archived、canonical appearance 两到三行、seed family。
- 右下：其余 approved/candidate 派生参考缩略图，显示 `derived_from` 血缘。
- 主动作：`上传参考图` 或 `查看参考图`；次要动作进入 `⋯`：编辑角色、审批候选、归档。
- 没有正式角色图 provider/job contract 时不显示“生成/重做”假按钮。以后接 Krea/Comfy 也必须产出 candidate Asset + lineage，再人工批准，不得直接覆盖主图。

### 2.3 场景资产带

- Scene 不是新真相实体：标题和镜头数来自 `ShotPlan.scene_id` 分组。
- 场景资产来自该组镜头 `semantic_references` 中 `purpose=reference_stage` 的 Asset；旧 `reference_bindings.role=scene` 只作兼容展示，不成为新的编辑真相。
- 资产卡显示 approved/candidate/archived，点击 lightbox；`登记素材` 复用现有 Asset API。只有 approved Asset 能进入 generation binding。
- 同一 Asset 被多镜引用时只渲染一张场景资产卡，用引用计数显示 `USED BY N SHOTS`。

### 2.4 三列 Shot 卡

每张卡严格有两个视觉分区，不能把 Take 冒充 Plan：

- `PLAN`：镜号、标题、时长、景别/运镜、动作摘要、preflight 状态；点击打开 `INPUTS / STATES`。
- `LATEST TAKE`：实际视频/首帧、`TAKE N`、job status、QC verdict、representative status；Take switcher 选择历史结果。
- 主动作由 server preflight 推导：`修复输入` / `生成` / `新建 Take` / `查看任务`。不得仅看有没有首帧 URL猜测。
- 媒体单击打开现有 `MediaLightbox`；卡内 video 默认 muted、不开 hover autoplay，避免 100 Shot 同时解码和违反可访问性预期。
- hover 只显示次要操作；键盘 `:focus-within` 和触屏必须同样看得到，不能把动作藏在 hover 唯一路径。

## 3. H3Storyboard 组件与数据映射

| P1.3 概念 | 现有事实/可复用组件 | 建议落点 | 数据真相 |
|---|---|---|---|
| 三视图切换 | `DirectorWorkspace.tsx:47-52, 96-138` 已有 `canvas/director` | 扩为 `ProductionBoardView`、`InfiniteCanvas`、现有 compare | 纯 UI 状态，不写业务表 |
| 制片墙编排 | `InfiniteCanvas.tsx:81-105` 当前同时编排左资产、Flow、Inspector、角色库 | 新建 `ProductionBoardView.tsx`，只消费 selectors；不要复用 React Flow 布局 | `ProjectSnapshot` + batch characters/references + preflights |
| 角色大卡 | `CanvasCharacterCard.tsx:20-39` 已能显示首个 approved reference | 新建 `ProductionCharacterCard.tsx`；Canvas 小节点继续保持轻量 | `Character` + 所有 `CharacterReference` + approved/candidate `Asset` |
| 角色引用加载 | `use-characters.ts:21-42` 目前 1 次 character list + N 次 refs | P1.3 开工第一项：项目级 batch references API/hook | 协议字段见 `character.ts:47-62, 97-103` |
| 场景聚合 | `storyboard-graph.ts:158-173` 已按 `scene_id` 形成 Scene group | 抽成纯 selector `selectProductionScenes`，Flow builder 和 Board 共用 | `ShotPlan.scene_id`；不新增 Scene 表 |
| 场景资产 | Graph 目前只投影被引用 Asset：`storyboard-graph.ts:106-140` | `SceneAssetStrip.tsx` 去重、计数、状态过滤 | `SemanticReference.purpose=reference_stage` + Asset；schema `compiled-binding.ts:4-8` |
| Shot 卡 | `CanvasShotCard.tsx:33-73` 已有 preview、GenerationControl、latest non-rejected Take | 新建 `ProductionShotCard.tsx`，复用 `GenerationControl` 和媒体组件，不把 Flow 卡膨胀 | `ShotPlan` / `H3Job[]` / `ShotActual[]` 分层传入 |
| Take/QC | `CanvasInspectorPanel.tsx:24-43, 83-91` 已按 job/output 精确关联；`CanvasTakeControls` 已存在 | 卡上显示摘要与 switcher，审核仍可进 Inspector | `ShotActual.job_id/output_asset_id/qc/representative` |
| 媒体 | `CanvasFlowNode.tsx:37-49`、`CanvasShotCard.tsx:50-58`、`MediaLightbox` | 抽 `LazyMediaSlot`，只给近视口媒体设置 `src` | canonical Asset `/media` 路由 |
| 血缘流程 | `StoryboardFlow.tsx:54-73, 121-170` 已有 React Flow、MiniMap、onlyRenderVisibleElements | 原样保留并改名“血缘流程”；只做 graph builder 拆分 | `StoryboardGraph` 投影，不产生业务写入 |
| Inspector | `CanvasInspectorPanel.tsx:45-95` 已显示计划、job、take、声音硬规则 | 提升为 Board/Flow 共用 `ProductionInspector`，中小屏改 drawer/sheet | 只读 projection + 明确 QC commands |

### 必须先拆再加

1. `apps/studio/src/lib/storyboard-graph.ts` 当前 249 行且 AGENTS 上限为 250；先抽 `storyboard-selectors.ts`、`storyboard-lineage.ts` 复用分组/索引逻辑，不能继续叠加 board selector。
2. 项目级 character reference batch API 必须先落地，消除 `use-characters.ts:28-30` 的角色 N+1。
3. Board 不得再次调用 `useAssets` 拉一份与 `ProjectSnapshot.assets` 重叠的数据；资产 manifest 辅助信息若需要，做单个项目级 bundle。

## 4. 明确禁止迁移

| xyz 行为 | 源码证据 | H3 P1.3 verdict |
|---|---|---|
| storyboard 同时存 first frame/video/audio/final URL | 卡片直接读 `sb.first_frame`, `sb.video_url`, `sb.audio_url`：`oii.html:3062-3073, 3137-3161, 3187-3212` | 禁止。Plan、Job、Asset、Take 始终分表/分区 |
| “重做”覆盖当前预览 | `oii.html:3065-3068, 3152-3155` | 改成“新建 Take”；旧 Take 不删除 |
| TTS/播放配音/音视频合成 | `oii.html:3187-3212` | 全部禁止；只允许 H3 原声或静音 |
| 流程阶段含 voices/audio/final | `oii.html:1520-1530` | 不出现。H3 阶段只显示 H3 Job 与 QC 推导状态 |
| 视频 hover 自动播放 | `oii.html:3140-3145` | 不复制；点击 lightbox 后由用户控制播放 |
| 全局 generating/SSE 日志槽 | `oii-app.js` 单体状态与旧 SSE 路径 | 不复制；状态按持久 `job_id`，先 DB 后 UI projection |
| 直接删除角色/场景/分镜 | `oii.html:2770-2773, 2899-2902, 3021-3024` | 默认 archive/supersede；危险删除不进卡片主动作 |
| Alpine 单体文件 | `oii.html` 4712 行、`oii-app.js` 5778 行、`oii-styles.css` 1011 行 | 不复制；每个 React UI 文件 <250 行 |

## 5. 响应式验收矩阵

| 视口 | Board 网格 | 角色/场景带 | Inspector | 必过条件 |
|---|---|---|---|---|
| ≥1440px | 3 列 Shot，卡宽 ≥280px | 横向带，角色大卡 440–560px | 右侧常驻 320px | 不遮挡 Flow 控件；首屏可见 ≥6 Shot |
| 1180–1439px | 2 列 | 横向带 | 右侧 drawer，保留显式“节点详情”按钮 | 画布/Board 切换后焦点不丢失 |
| 900–1179px | 2 列 | 横向带 | drawer overlay | 页面本身无横向滚动；资产带可独立横滚 |
| <900px | 1 列 | snap 横向带 | bottom sheet | 卡内主动作永远可见；44×44px 触控目标 |

浏览器矩阵：Chromium 桌面 `1440×900 / 1280×800 / 1024×768`，移动 `390×844`。四档均断言 `document.documentElement.scrollWidth === clientWidth`；允许带自身横向滚动，不允许整页横溢。

## 6. 可访问性验收

1. `ProductionBoardView` 使用 `main/section/h2`；场景是有名称的 `section`，分镜墙是按 ordinal 排序的列表，卡片为 `article`。
2. 卡片不可只靠整体 `div @click`；打开详情、生成、媒体、Take、QC 都是原生 `button`，有可区分的 accessible name，例如“SHOT 018 新建 Take”。
3. hover action 同时支持 `:focus-within`；`@media (hover:none)` 下主动作常显。不得复制 xyz 的 hover-only 媒体按钮。
4. 键盘顺序按角色 → 场景 → Shot ordinal；切换 Board/Flow/计划实测后，焦点落到新视图 `h1/h2` 或已选 Shot，而不是回到 body。
5. QC/Job 状态变化使用局部 `aria-live=polite`；错误 `role=alert`；不让整个 100 Shot 列表重复朗读。
6. 文本对比 ≥4.5:1，非文本边界/状态 ≥3:1；颜色之外同时显示文字 `pending/approved/rejected`。
7. 卡内视频不 autoplay；尊重 `prefers-reduced-motion`；loading skeleton 不闪烁。
8. `axe` 结果 0 critical/serious；Playwright 键盘测试必须完成“选中 Shot → 打开 Take → 返回原卡”。

## 7. 100 Shot 性能验收

### 测试数据

- 10 scenes × 10 ShotPlan = 100 Shot；20 characters；每 Shot 2 Take；50% 有视频；每 Scene 4 个去重场景 Asset。
- 运行真实 HTTP + SQLite；不是把 JSON 直接注入 React。

### 可测预算

1. **请求规模**：选择项目进入默认 Board 后，除已完成的项目列表外，项目级 JSON 请求最多 3 个：snapshot、batch character/reference、batch preflight；不得出现 per-character/per-shot N+1。Flow 未打开前不加载 canvas layout。
2. **媒体规模**：首屏/近视口才挂媒体 `src`；初始图片/视频请求合计 ≤12，离屏 100 Shot 不得触发视频 metadata 请求。
3. **交互预算**：本地 warm run 下，点击视图切换到首个可交互卡 ≤500ms；选择 Shot 到 Inspector 标题更新 p95 ≤100ms；连续滚动期间不得出现 >100ms Long Task。
4. **DOM/渲染策略**：100 张语义卡可以保留在 DOM 以支持查找和无障碍；场景 section 用 `content-visibility:auto`，媒体用 IntersectionObserver 近视口挂载。若超过预算再虚拟化，不能一开始牺牲键盘顺序。
5. **轮询约束**：`use-studio.ts:54-66` 仅在 active job 存在时 2 秒拉 snapshot；P1.3 selector 必须保持 O(entities) 且 memoized，不能每张卡重复 `array.filter` 全量扫描。
6. **图视图约束**：React Flow 已启用 `onlyRenderVisibleElements`（`StoryboardFlow.tsx:154-159`），但 graph 构建仍全量；切换 Flow 的节点/边构建必须在测试数据上 ≤100ms，并且不阻塞 Board 首载。

### 自动化用例

- `tests/e2e/production-board.spec.ts`：100 Shot fixture，记录 request ledger、媒体 request ledger、视图切换、scene jump、Take switcher、键盘焦点和 4 个断点截图。
- `tests/integration/character-reference-batch.test.ts`：真 HTTP + SQLite，一次返回所有角色及 references，覆盖跨项目、candidate/archived 与空角色。
- `tests/unit/production-board-selectors.test.ts`：100 Shot/200 Take 的 scene/character/job/actual 索引，断言 Plan 对象未被投影函数修改。

## 8. 推荐实施顺序与出门条件

### Slice A · 数据与拆分

- 项目级 character/reference batch API + 真 HTTP/SQLite 测试。
- 拆 `storyboard-graph.ts`，建立一次性 Map 索引与可复用 board selectors。

### Slice B · Board 骨架

- `DirectorWorkspace` 三视图；默认 Board、懒加载 Flow。
- `ProductionBoardView` + `ProductionCharacterStrip` + `SceneProductionSection` + `StoryboardWall`。

### Slice C · 直接操作密度

- 角色大卡/场景资产带/Shot Plan 与 Latest Take 双区卡。
- 复用 `GenerationControl`、`MediaLightbox`、`CanvasTakeControls`；hover/focus/touch 同等动作。

### Slice D · 门禁

- 响应式、axe、键盘、100 Shot request/media/performance E2E。
- 真 HTTP + SQLite 覆盖 candidate→approved reference、QC reject、409/500 恢复。
- `pnpm check && pnpm build && pnpm test`，再做四路独立 review；任一维度低于 B- 不交付。

## 最终判断

P1.3 不是把 xyz 的 HTML 搬进 React Flow，也不是把 H3Storyboard 变成另一个 wizard。正确做法是：**借 xyz 的制片墙展示密度，继续由 H3Storyboard 的 Protocol/SQLite/Job/Take/QC 管真相。** Board 负责“看得全、动作近”，Flow 负责“关系可追溯”，计划/实测负责“单镜精判”。
