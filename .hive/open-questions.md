# Open Questions

> AI 自动维护此文件。每条 Q 是 AI 遇到"自己办不了、必须问 user"的事。user 在 Cockpit Questions tab 答复。

## 待 user 拍板（按优先级）

### 🔴 high — 阻塞 ongoing 工作

- **Q4** 🔴 隧道持久化：本机 `admin01` 的 sudo 需要密码，worker 无法把已准备的 unit 安装到 `/etc/systemd/system/` 并 enable；需 user 执行安装命令或提供可用提权路径。(2026-08-11)

### 🟠 medium — 影响下一步规划

- **Q5** 🟠 画布直接操作化范围：是否按 2026-08-13 OiiOii 调研建议，先实施 P0“节点生成/新 Take + 同视图 inspector + per-job 进度 + Take 预览/QC”，将框选批量、suggestion 和语义连线留到 P1/P2？核心方向已确认，本题只确认实施切片与优先级。(2026-08-13)

### 🟢 low — 灰度区

- **Q1** ✅ 画布与 planned/actual 关系：本轮验收明确要求共存，已实现“画布 / 计划与实测”切换。(2026-08-11)

## 已答（archive 留追溯）

- **Q3** ✅ 2026-08-11 user 已放行安全组并确认浏览器可访问 http://106.14.227.192:9994。

- **Q2** ✅ 2026-08-11 user 拍板：角色实体按最小字段集——规范外观文本 + 参考图集 + seed 族 + 派生血缘；服装/造型状态机后置。ADR：.hive/decisions/2026-08-11-character-entity-minimal-fields.md
