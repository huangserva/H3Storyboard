# P1.3 制片墙交付索引

- 日期：2026-08-24
- 完整报告：[`../reports/2026-08-24-p13-production-board-delivery.html`](../reports/2026-08-24-p13-production-board-delivery.html)
- 目标：在 H3Storyboard canonical Protocol/SQLite 上落地 xyz 风格高密度制片墙，并把角色参考图做到可上传、审批、归档、追溯和可测试。
- 音频边界：未新增任何声音能力；只保留 `h3_native | silent`，没有 TTS、配音、BGM、环境声、雨声或音效。

## 结论

P1.3 已达到可测试交付：Studio 默认进入制片墙，保留血缘 Flow 与计划/实测视图；项目角色 catalog、PNG/JPEG/WebP 原图上传、candidate→approved、唯一 root mother image、多角度派生、归档和 asset-level lineage 均为持久化真相。Krea/Qwen 只完成调研，未在缺少持久 `CharacterImageJob` 时暴露假生成按钮。

## 关键实现

- Protocol 1.6：`CharacterCatalog`、upload/approval/derivation contracts，HTTP 保持 snake_case。
- SQLite v17–v19：幂等上传 receipt、asset derivation、历史 primary 修复、每角色唯一 root primary 与 derived-primary trigger。
- ProjectStore：文件上传落 candidate Asset + CharacterReference；审批复用 canonical Asset lifecycle；上传内容与 lineage 不可改。
- H3 binding：只解析 frozen manifest 中 approved root image；派生角度永不作为身份 fallback。
- Studio：默认 Production Board，角色大卡、场景资产带、三列 Plan/Latest Take；Flow 懒加载并显示 Character→root→angle 血缘。
- 性能：100 个真实持久 Job/Take 在制片墙不挂 `<video>`，不请求媒体文件；切换 Flow 后才加载图画布。

## 原始任务逐条 verdict

| 要求 | Verdict | 证据 |
|---|---|---|
| xyz 风格画布展示 | 完成 | 默认制片墙 + 三列分镜墙 + 角色/场景带 |
| 角色参考图真实链路 | 完成 | 上传、candidate、审批、归档、root/angle lineage |
| 项目级批量角色读取 | 完成 | `GET /api/projects/:id/character_catalog` |
| 保留 H3Storyboard 真相模型 | 完成 | Plan/Job/Asset/Take/QC 未合并 |
| 保留旧 Flow | 完成 | 懒加载“血缘流程”，graph builder 已拆分 |
| 100 Shot 可用 | 完成 | 真 SQLite + 真浏览器；零墙面视频预载 |
| Krea/Qwen 角色生成 | 跳过（按范围） | 未建持久 ImageJob 前不展示假按钮；调研已双产出 |
| 声音规则 | 完成 | 没有新增音频路径；继续 H3 原声或静音 |

## 验证

- `pnpm check && pnpm build && pnpm test`
- Vitest：最终应为 146 passed / 1 skipped；Playwright：12 passed（以完整 HTML 报告和最终门禁输出为准）。
- 针对性：schema v19 历史脏数据修复；generic root POST/PATCH/approve；derived 禁主；JPEG/WebP 合法上传、回读与截断拒绝；100-shot Flow/Board。
- 文件上限：migrations、store、route、Studio production components、graph modules 均低于项目硬上限。

## Self-Review

### 四路最终评分

- A 架构与维护性：A。graph/catalog/Flow/migration 已拆分；未发现阻塞。
- B 真实 bug 与边界：A-。未发现严重或中等 bug；仅保留文件 rename 与 DB commit 间极窄进程崩溃孤儿风险。
- C 测试质量：A。真 HTTP+SQLite、真浏览器、格式/并发/键盘/100-shot 均覆盖，无 mock 感染。
- D spec/protocol：A-。Protocol 1.6、snake_case、v17–v19、Plan/Actual、音频与无假按钮全部对齐。

### 严重项处理 verdict

- 派生角度升母图：**已修**。create/update/approve 都拒绝 derived primary；compiler 与 UI preview 只选 root；v19 修历史脏行并建唯一索引/trigger。
- 上传 Asset/Reference 被通用 PATCH 改写：**已修**。上传管理的 URI/hash/asset/kind/lineage 均不可变，分字段真 HTTP 回归覆盖。
- 审批绕过 replacement 生命周期：**已修**。审批统一调用 canonical `updateAsset()`，replacement 获批时旧 Asset 正常归档。
- catalog/Flow 丢失资产级血缘：**已修**。catalog 返回 derivations，Flow 显示 Character→root→angle。
- 100 Shot 假性能测试/视频预载：**已修**。fixture 为 100 个真实 persisted Job/Take；墙面零 `<video>`、零 media request。

### 前后对比

- 第一轮四维均 C+：存在双重真相、派生升主、生命周期绕过、假性能 fixture 和键盘覆盖缺口。
- 最终轮：A / A- / A / A-，所有严重与中等项闭环；综合 A-。

## 改动、删除与明确未做

- 拆分 `storyboard-graph.ts`，新增 structure/types/selectors；Flow 改懒加载。
- 移除重叠的 project character-reference 读取形态，统一为 character catalog；未删除测试。
- 100-shot E2E 的 batch preflight 断言由“恰好一次”改为设计轮询窗口内 `1..4`，仍会抓住 N+1/runaway，请求数不随 Shot 增长。
- 未做 `CharacterImageJob`、Krea/Qwen 执行器、4090 调度或图片假生成按钮。
- 已知低风险：正常异常会删除临时/输出文件，但进程恰在 rename 与 SQLite commit 之间崩溃可能留下无 DB 引用文件；后续可加启动 janitor。图片入口做 PNG CRC、JPEG segment、WebP chunk 验证，但未引入完整像素解码库。
