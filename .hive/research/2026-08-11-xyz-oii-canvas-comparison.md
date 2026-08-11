# xyz-video-creator（oii）画布 vs H3Storyboard 画布对比索引

- 完整报告：[`../reports/2026-08-11-xyz-oii-canvas-comparison.html`](../reports/2026-08-11-xyz-oii-canvas-comparison.html)
- 调研日期：2026-08-11
- 来源：`git@github.com:huangserva/xyz-video-creator.git`（私有，SSH 可达），检视 commit `67d11bf`。画布在 `frontend/oii-app.js`（5778 行 Alpine.js 单文件）+ `oii.html`（4712 行）。

## 问题

user 指出 xyz 项目已有无限画布，问与 H3Storyboard 新画布原型有何不同。

## 关键事实（xyz oii 画布）

1. 技术栈：Alpine.js（CDN 引入），单文件 5778 行，无构建、无测试。
2. **节点位置持久化在后端**：`POST /api/oii/projects/{id}/canvas-nodes`，字段 node_type / ref_id / x / y / width / height / z_index —— 比我们 localStorage 方案更正。
3. **角色和分镜同画布**：node_type 有 `character` 和 `storyboard` 两种，角色 3 列网格起手、分镜 4 列网格起手，ref_id 指向实体。
4. 交互：滚轮以鼠标为中心缩放（scaleRatio 反推 pan，clamp 0.2–3）+ 按钮步进缩放；节点拖拽时 z_index 提到最高；`zoomToNode` 点击聚焦居中；`canvasReset` 一键复位。
5. 生成动作挂在画布实体上（主形象图/设定图/场景图批量生成，SSE 日志流）。
6. 无场景分组框；无 planned/actual 概念（生成结果直接更新在同一实体上）。

## 对比结论

- 定位：xyz 画布 = 生成工作区（实体可变、生成结果就地覆盖）；H3Storyboard 画布 = 协议之上的规划视图（planned/actual 分离不被视图破坏）。
- 值得搬进 H3Storyboard：① canvas-nodes 后端持久化模式（替代 localStorage，M2 补 migration）② 角色节点上画布（与 M2"角色库联动"吻合，node_type 枚举照抄）③ zoomToNode 聚焦 ④ 拖拽 z_index 提升 ⑤ 画布内挂生成动作 + SSE 日志（M1B 接通后）。
- 不搬：Alpine 单文件形态（违反 AGENTS.md 250 行规则）；生成结果就地覆盖实体的语义（违反 planned/actual 分离）。

## 影响

- M2 画布迭代清单更新：位置持久化迁 SQLite（canvas_nodes 表）、角色节点、zoomToNode、z_index。
- 不改里程碑结构。xyz oii 后端还有 locations/characters/storyboards 的 CRUD 与建议流（content_type: script/character/storyboard），M1A 设计角色实体时可再参考其字段。
