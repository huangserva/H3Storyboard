# P1.1 批量画布首载与 generation preflight 索引

- 日期：2026-08-24
- 完整交付报告：[`../reports/2026-08-24-p11-batch-canvas-preflight.html`](../reports/2026-08-24-p11-batch-canvas-preflight.html)
- 分支：`codex/p0-p1-h3-canvas`
- 实施基线：P1 commit `a621432`
- Protocol：1.5

## 问题

P1 画布虽然已经能显示完整血缘，但 100 Shot 首载仍会逐镜创建坐标、逐镜读取 preflight。远端 4090 链路下请求量为 O(Shot)，多标签页同时打开还会竞争同一 `canvas_nodes` 唯一键；项目快速切换时，旧请求也可能污染新项目 UI。

## 实施结论

1. 新增 `PUT /api/projects/:project_id/canvas_nodes`：请求内 ref 唯一、先验证全部 ref、单个 SQLite immediate transaction 原子 upsert。默认保留已有节点；只有 `update_position_if_untouched=true` 且节点从未被用户改动时，才迁入旧 localStorage 的 x/y。
2. 新增 `GET /api/projects/:project_id/jobs/preflights`：在一个一致性读事务内取得 snapshot、lock、brief 和全部 binding compilation；共享 manifest/asset/character 查询，按 Shot ordinal 返回。
3. Studio 每项目首载固定为一次 canvas batch PUT 和一次 batch preflight GET。共享请求注册表消除 React StrictMode 重放的重复请求，并在项目切换时 abort 旧请求。
4. 单节点 canvas CRUD、单镜 preflight、Plan/Actual、H3 job 不可变快照和 `H3 原声 | 静音` 规则全部保留。

## 关键验证

- 两个真实 HTTP server 共用同一 SQLite：20 个并发 batch PUT 对同一节点只创建一行并返回同一 ID。
- 事务中途由真实 SQLite trigger 令第二条 INSERT 失败：API 返回 500，第一条 INSERT 确认回滚。
- 默认幂等不改位置；仅未触碰节点允许旧坐标迁移，且只改 x/y、不改 width/z；第二次过期迁移不能覆盖。
- batch preflight 同时返回 ready/blocked，顺序与 Shot ordinal 一致；缺项目返回 404。
- 两个浏览器标签分别加载真实 100 Shot 项目：每标签只有一条 canvas PUT、一条 batch preflight GET，零单镜 preflight，请求与数据库均有 100 个唯一 ref。
- 项目切换 E2E 分别确认旧 canvas 与旧 preflight 请求被 abort，且旧 localStorage key 未被错误清除。
- 全量：Vitest 124 passed / 1 skipped；Playwright 5 passed；`pnpm check`、`pnpm build`、`git diff --check` 通过。

## Review 结论

- A 架构：B-。ProjectStore 超 300 行、重复 DB context 和多事务快照均已修；拆出 CanvasStore 后 ProjectStore 为 298 行。
- B 真实 bug：B-。多标签冲突、部分写、stale response 和 N+1 均关闭。
- C 测试：B+。首轮伪 rollback、abort 未覆盖和 100 Shot 弱断言均改为真穿透。
- D Spec：A。兼容 API、运行时输出 schema、一致性事务、响应错误分类、batch item 唯一性全部复核通过。

## 明确未做

- 已加载标签之间没有实时广播后续拖拽/角色布局变化；刷新后会读到最新 SQLite 状态。
- 浏览器测试尚未覆盖“成功的旧 localStorage 坐标迁移”和 character placement；原子迁移已有 HTTP+SQLite 集成覆盖。
- batch preflight 还缺一条专门切换 representative gate override 的测试；单镜门禁已有既有集成测试。
- project snapshot 本身仍按 2 秒轮询并传输 O(project) 数据；这不属于 P1.1 两条 batch API。
- Studio production bundle 仍有 534 KB chunk warning，后续可按 Inspector/Production panel 拆包。

## 下一阶段

P1.2 建立真实 Character/Asset/Job/Take/视频媒体 fixture，穿透 media lightbox、Take 切换和 QC；P1.3 再提升 xyz/OiiOii 式卡内直接操作密度。两阶段都不改变 Plan/Actual 与 H3-only audio。
