# P2.1 Script Studio 交付索引

完整自包含报告：

- [2026-08-26-p21-script-studio.html](../reports/2026-08-26-p21-script-studio.html)

## 结论

P2.1 已把原来的 locked-text 封套扩展成可测试的结构化剧本入口：
plain text / shuohao JSON 导入、Scene/Beat 编辑、确定性校验、revision
并发保护、不可变锁定、幂等编译，以及带完整状态和来源血缘的草稿
ShotPlan。编译只到画布，不访问 4090。

## 工程证据

- Protocol 2.0 / SQLite migration v24。
- 真 HTTP + SQLite 覆盖正常、错误、并发、回滚、幂等、历史追加和
  单镜/批量 draft H3 门禁。
- 真 Chromium 覆盖导入、编辑、保存、校验、锁定、编译、刷新恢复、
  版本选择和后继版本入口。
- 最终门禁：272 passed / 1 live skip；25 Chrome passed。
- 独立复审：A 架构 B-、B bug B、C 测试 B+、D 协议 A-。

## 下一步边界

P2.2 才做 draft Plan 编辑/diff/approve 和 plan-set supersede。P2.1 不会在
新剧本刚锁定时停掉旧 approved Plan，避免破坏进行中的生产；批准切换
必须成为下一阶段的一次显式事务。
