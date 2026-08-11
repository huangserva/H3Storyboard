# Infinite Canvas 原型技术选型笔记

日期：2026-08-11  
关联：M2 / dispatch `34a29e50`

## 已核对边界

- `DirectorWorkspace` 现有 planned/actual 比较视图保留，只增加工作区切换。
- 数据源继续使用 `ProjectSnapshot.shot_plans` 与 `shot_actuals`；无 schema、API、protocol 变更。
- 位置属于展示偏好，以 `h3storyboard.canvas.v1.<project_id>` 隔离存入 localStorage。

## 方案比较

| 方案 | 优点 | 本轮代价 | 结论 |
| --- | --- | --- | --- |
| CSS transform + Pointer Events | 零依赖、契约面小、足够覆盖 pan/zoom/drag | 自行维护交互细节 | 采用 |
| React Flow 类图编辑库 | 节点、连线、视口能力完整 | 本轮无连线需求，引入依赖与样式体系较重 | 暂缓 |

## 实现要点

- 缩放通过屏幕指针反算世界坐标，更新 zoom 后保持该世界点不动。
- 卡片拖动增量除以 zoom，确保持不同缩放级别下手感一致。
- scene 分组框由当前卡片位置实时求包围盒，卡片移动后分组仍可辨识。
- persisted JSON 只接受有限数值坐标，坏数据降级为空布局，不进入业务记录。

## 后续索引

- 正式跨设备布局、协作或连接边需求出现时，再评估画布库及编号 migration。
- 大规模镜头项目需增加可见区域裁剪基准测试。
