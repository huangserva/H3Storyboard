# 决策：无限画布原型采用 React 状态 + CSS transform

**日期**: 2026-08-11
**状态**: 提案中
**关联**: plan.md → M2 · 无限画布 Studio

## 背景
本轮目标是尽快验证无限画布、多场景组织与 planned/actual 共存体验，不改变后端协议或 SQLite schema。

## 决策
使用原生 Pointer/Wheel 事件、React 局部状态与单层 CSS `translate + scale`；卡片世界坐标以 project id 分区写入 localStorage。暂不引入 React Flow 等图编辑库。

## 理由
1. 当前需求只有平移、指针中心缩放、卡片拖动和场景框，不需要连线、端口或图算法。
2. 不新增运行时依赖，原型更容易审阅和替换。
3. planned 与 actual 仍来自同一真实快照并分开展示，没有改变产品真值边界。

## 已知代价
- 指针、键盘和可访问性细节由项目自己维护。
- localStorage 布局不跨浏览器同步；正式布局持久化仍需后续产品决策与 schema migration。
- 镜头量很大时需要评估视口裁剪或虚拟化。

## 结果（后写）
原型实现约 177 行主组件，纯布局数学有独立单元测试；5 镜头、2 场景演示数据可即时呈现。
