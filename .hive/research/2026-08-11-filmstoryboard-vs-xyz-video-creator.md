# H3 Storyboard 选型索引

- 完整报告：[`../reports/2026-08-11-filmstoryboard-vs-xyz-video-creator.html`](../reports/2026-08-11-filmstoryboard-vs-xyz-video-creator.html)
- 调研日期：2026-08-11
- `filmstoryboard`：公开仓库 `luojiang419/filmstoryboard`，检视提交 `d7572b15ef5ad0bdd378748679c67ab724f9a11f`。
- `xyz-video-creator`：原 URL 匿名访问要求凭据；可验证材料来自公开迁移仓库 `huangserva/xyz-video-skill` 的 `refactor/video-creator` 分支，检视提交 `06837a0353d8efa8cad990869a85a6e7426f11f`。

## 决策

建立独立仓库，不 fork、不复制粘贴、不把两个状态模型硬缝在一起。

- 借 `filmstoryboard`：桌面工作台信息架构、项目/素材管理、H3 入口、Windows 发布经验。
- 借 `xyz-video-*`：完整剧本先行、`scenes > shots`、用途驱动参考素材、生成后 QC 与重跑谱系。
- 自建：版本化 Zod 协议、SQLite 单一写入口、本地 HTTP API、Provider adapter、计划分镜与实测 take 分离、可恢复任务状态机。

## 不直接复用代码的原因

两个检视快照均未发现明确的 `LICENSE` 文件；技术栈分别为 Flutter/Dart 桌面应用与 Python/JSON skill；状态持久化、任务语义和产品入口不一致。未经许可复制代码有版权与维护风险。

## 后续 PM 关注

1. `ShotPlan -> H3Job -> ShotActual` 必须追加历史，不能覆盖。
2. `input_bindings` 同时承载上传顺序与 prompt 中 `@图片N/@视频N/@音频N` 的用途。
3. 连续性应引用已批准 take 的版本化资产，不能只存 `chain_from_previous=true`。
4. M1 再接真实 H3 provider；M0 先把协议、持久化、UI 和穿透测试做实。
