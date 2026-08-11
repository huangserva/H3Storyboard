# Open Questions

> AI 自动维护此文件。每条 Q 是 AI 遇到"自己办不了、必须问 user"的事。user 在 Cockpit Questions tab 答复。

## 待 user 拍板（按优先级）

### 🔴 high — 阻塞 ongoing 工作

- **Q3** 🔴 公网访问：请在阿里云安全组放行 TCP `9994`（来源范围由 user 决定）；中转机 nginx 已监听且本机公网 curl 当前超时。(2026-08-11)
- **Q4** 🔴 隧道持久化：本机 `admin01` 的 sudo 需要密码，worker 无法把已准备的 unit 安装到 `/etc/systemd/system/` 并 enable；需 user 执行安装命令或提供可用提权路径。(2026-08-11)

### 🟠 medium — 影响下一步规划

- **Q2** 🟠 角色定义范围：角色实体最少需要哪些字段？h3-film-studio 实证给出建议答案：规范外观文本（可逐字注入 prompt）+ 参考图集 + seed 族 + 派生血缘为最小集，服装/造型状态机后置——user 确认即按此定 M1A 协议。证据见 .hive/research/2026-08-11-h3-film-studio-assessment.md。(2026-08-11)

### 🟢 low — 灰度区

- **Q1** ✅ 画布与 planned/actual 关系：本轮验收明确要求共存，已实现“画布 / 计划与实测”切换。(2026-08-11)

## 已答（archive 留追溯）

（暂无）
