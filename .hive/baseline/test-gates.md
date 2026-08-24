# Test Gates

> 保持 200 行以内；超出时拆分并把历史细节移到 .hive/archive/。

交付前固定执行：

1. `pnpm check`
2. `pnpm build`
3. `pnpm test`

新增协议/Store/API 功能必须至少有一条 `tests/integration/` 真 HTTP + 真 SQLite 穿透；禁止 mock fetch、node-pty 或 Store 冒充集成测试。浏览器行为放 `tests/e2e/`，由 Playwright 启动真实 API/Studio。

画布性能/并发变更至少验证：重复和并发 batch ID 稳定、非法混合批整单回滚、两个 API server 同库、两个浏览器标签页、100 镜首轮每页恰好一个 canvas PUT 和一个 preflight GET、数据库唯一 ref 数准确。

每个里程碑在最终交付前须完成架构、bug/边界、测试质量、spec/协议四路独立 review；所有维度至少 B-，严重项逐条 verdict 并进入 HTML 报告的 Self-Review。
