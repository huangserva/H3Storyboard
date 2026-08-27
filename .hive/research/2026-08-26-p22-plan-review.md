# P2.2 Plan Review 交付索引

完整自包含报告：

- [2026-08-26-p22-plan-review.html](../reports/2026-08-26-p22-plan-review.html)

## 结论

P2.2 已把 P2.1 的 draft ShotPlan 补成可审核的 plan-set：来源对照、逐镜
diff/编辑、revision 并发保护、显式批准，以及 active approved plan-set 的
原子切换。批准以前不允许 H3；批准以后只允许当前 active Plan 新建任务。

## 工程证据

- Protocol 2.1 / SQLite migration v25。
- `plan-review-store.ts` 管事务，projection/diff 单独拆分；API 只有 3 个端点。
- 真 HTTP + SQLite 覆盖错误、并发、回滚、幂等、来源损坏、历史不变与 H3 门禁。
- 真 Chromium 覆盖多卡脏状态、逐镜保存、批准、进入画布和刷新恢复；
  2026-08-27 补空态无重叠、首屏 CTA、1024/700px、draft/locked/
  superseded/active 入口与 stale review 只读。
- 最终门禁：279 passed / 1 live skip；27 Chrome passed。
- 独立复审：A 架构 A-、B bug A-、C 测试 B、D 协议 A。

## 决策与下一步

active plan-set 的事务边界见
[2026-08-26-active-plan-set-approval.md](../decisions/2026-08-26-active-plan-set-approval.md)。
P2.3 可在现有 ScriptVersion draft 边界前增加可选 AI 写作，但不得直接锁定、
编译或批准，也不得引入 TTS 或任何外部声音。
