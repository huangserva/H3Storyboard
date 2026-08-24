# Open Questions

> AI 自动维护此文件。每条 Q 是 AI 遇到"自己办不了、必须问 user"的事。user 在 Cockpit Questions tab 答复。

## 待 user 拍板（按优先级）

### 🔴 high — 阻塞 ongoing 工作

- **Q4** 🔴 隧道持久化：本机 `admin01` 的 sudo 需要密码，worker 无法把已准备的 unit 安装到 `/etc/systemd/system/` 并 enable；需 user 执行安装命令或提供可用提权路径。(2026-08-11)

### 🟢 low — 灰度区

- **Q1** ✅ 画布与 planned/actual 关系：本轮验收明确要求共存，已实现“画布 / 计划与实测”切换。(2026-08-11)

## 已答（archive 留追溯）

- **Q5** ✅ 2026-08-24 user 选择先做 P1.3；默认制片墙吸收 xyz 的高密度角色/场景/分镜展示，React Flow 保留为血缘流程，框选批量和 suggestion 未进入本里程碑。

- **Q3** ✅ 2026-08-11 user 已放行安全组并确认浏览器可访问 http://106.14.227.192:9994。

- **Q2** ✅ 2026-08-11 user 拍板：角色实体按最小字段集——规范外观文本 + 参考图集 + seed 族 + 派生血缘；服装/造型状态机后置。ADR：.hive/decisions/2026-08-11-character-entity-minimal-fields.md
