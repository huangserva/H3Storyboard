# Risk Hotspots

> 保持 200 行以内；超出时拆分并把历史细节移到 .hive/archive/。

- `canvas_nodes` 只持久化 shot/character anchor；asset/job/take/scene 都是派生节点，禁止另建业务真相。
- 画布 batch 默认只能 ensure。`update_position_if_untouched` 仅允许未被 PATCH 的行迁移 x/y，不能演变成通用覆盖接口。
- Preflight batch 中只捕获预期 `StoreError` 为 per-shot blocking error；未知异常必须整体 500，不能伪装为“镜头未就绪”。
- 100 镜画布仍每 2 秒拉完整 ProjectSnapshot；P1.1 只消除了首载 N 次 canvas 写和 N 次 preflight HTTP，snapshot 增量化仍是后续性能项。
- 两个 API 进程可共享 SQLite WAL，但写路径必须保持 immediate transaction + busy_timeout；不要改回 select-then-insert。
- 外部音频、TTS、BGM、环境声、雨声和后期混音永远不能进入 render path；只保留 H3 原音或静音。
- `demo:canvas` 必须始终显式设置 `H3_WORKER=0` 并使用独立数据库；不能把 demo seed、静态媒体或测试分支接进生产 API。
- Character canonical appearance / costume state 必须与 approved reference 对齐；画布预览只能优先使用 approved image reference，不能用未审批候选图冒充定妆。
