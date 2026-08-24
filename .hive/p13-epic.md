# P1.3 Epic Brief — Production Canvas And Character References

## Epic 目标

- 对应 `plan.md` milestone：P1.3
- 用户目标：在当前线上最新版 H3Storyboard 基础上，吸收 `xyz-video-creator` 的高密度画布展示方式，并把角色参考图工作流做到可直接测试。
- 原始任务语义：实现、测试、调研与对比。
- **硬规则：** H3Storyboard 继续是产品与数据模型唯一主线；外部项目只提供经验证的交互和实现参考。
- 仓库上层的 Hive design spec 约束团队执行纪律，但不定义 H3Storyboard 领域协议；本里程碑领域真相由本 brief、`docs/protocol.md` 与编号 migration 共同约束。

## 不可变需求（planning 前锁定）

- 必须满足：
  - 角色卡支持本地图片上传、候选预览、批准、归档和多参考图展示。
  - 增加项目级角色参考图批量读取接口，消除当前逐角色请求。
  - Krea2 / Qwen 的后续母图生成只有在建立可恢复、可查询的持久化图片任务后才能暴露；P1.3 先交付上传、审批和派生血缘，不放假按钮。
  - 资产血缘保留来源资产、派生类型和生产任务；批准态继续是生成绑定的唯一可信来源。
  - 提供借鉴 `xyz-video-creator` 的高密度生产视图：角色区、场景素材区、分镜墙分层展示，并继续读取同一 canonical snapshot。
  - 先拆分已接近上限的 `storyboard-graph.ts`，新增 UI / 数据逻辑不得继续堆进该文件。
  - API 使用 snake_case、稳定错误码；新增 schema 使用编号 migration。
  - 新链路必须有真实 HTTP + SQLite 集成测试以及真实浏览器 E2E。
  - 声音规则保持不变：只允许 H3 原始声音或静音；禁止 TTS、配音、音乐、环境声、雨声和音效。
- 明确不做：
  - 不迁移 `xyz-video-creator` 的旧数据模型和同步 SSE 任务实现。
  - 不把计划态和实际执行态混为同一个节点或状态。
  - 不复用 H3 视频任务表达图片生成任务。
  - 不隐式启动 4090 任务，不覆盖或删除现有用户资产。
  - 不扩展任何音频能力。
- 成功定义：
  - 用户能在常驻本地 Studio 打开一个有真实项目数据的画布，上传并管理角色参考图，看到高密度角色/场景/分镜展示。
  - Krea2 / Qwen 的真实模型、graph 与风险形成配对调研报告，为后续 CharacterImageJob milestone 提供可验证输入。
  - `pnpm check && pnpm build && pnpm test` 全通过，四路独立 review 均达到 B- 以上。
- 变更流程：任何需求变更必须回到用户确认，planner / reviewer 不能改需求。

## 阶段计划

| 阶段 | 目标 | 交付物 | verifier | 闸门 |
|---|---|---|---|---|
| 1 | 清除扩展瓶颈 | graph builder 拆分、批量 reference API | 协议/架构 review | 类型检查 + 真 HTTP/SQLite 测试 |
| 2 | 建立角色资产链路 | 上传、候选审批、血缘、图片任务协议与存储 | bug/边界 review | 错误路径 + migration + 并发测试 |
| 3 | 建立生产画布 | 高密度角色区、场景素材带、分镜墙 | UI/E2E review | 真实浏览器操作通过 |
| 4 | 核验 Krea2 | 配对源码报告与 CharacterImageJob contract 建议 | spec/运维 review | 不暴露假按钮、无隐式 4090 副作用 |
| 5 | 交付 | 报告、全量门禁、四路 review 整改、常驻测试地址 | PM | 全部完成定义满足 |

## 对抗式 planning / review

- planner 输入：P1.3 原始要求、H3Storyboard 当前协议、`xyz-video-creator` 展示层、Krea2 实际工作流、P1.2 遗留扩展点。
- reviewer 输入：本 brief、`AGENTS.md`、`.hive/plan.md`、变更 diff 与全部验证记录。
- reviewer 不能改需求，只能指出风险、缺口和阶段闸门问题。
- PM 裁决：严重项逐条修复或给出明确不修原因；任一维度低于 B- 必须整改并复审。

## 执行记录

- 当前阶段：完成
- 已完成阶段：1–5
- 阻塞：无；原先延期的 Krea/Qwen 执行器已由下方 P1.3B 需求变更补回。
- 原 P1.3 门禁：四路 review A / A- / A / A-；P1.3B 最终门禁见下方。

## P1.3B 需求变更 — 真实角色图生成闭环

2026-08-24 用户明确要求把原先延期的 4090 与角色图生成补回 P1.3，
因此不改写上面的历史验收结论，追加 P1.3B 作为同一 epic 的增量范围。

- [x] 独立 `CharacterImageJob`、事件、immutable single retry 与 SQLite migration v20–v21。
- [x] Krea 母图、Qwen identity edit、Krea i2i 三条确定性 graph；默认无 LoRA，
  服务端 allowlist 之外的 LoRA 拒绝。
- [x] H3 video / character image 共用按 GPU host 的持久 lease；提交前同时检查
  8188/8190 队列，仅释放配置为 managed 的实例并验证最小空闲显存。
- [x] submit intent、同 task 恢复、heartbeat、retry、精确 cancel、稳定失败码。
- [x] 完整像素解码、原子落盘、candidate Asset/Reference/derivation 单事务登记、
  运行末再次校验 frozen source；孤儿文件仅隔离，不删除。
- [x] 制片墙生成表单、active-only polling、真实状态、取消/重试、candidate 人工批准、
  manifest stale 与重新冻结 CTA。
- [x] 真 HTTP+SQLite、浏览器 E2E 与真实 4090 三路径 smoke。
- [x] 编译后主进程贯通 image worker，并覆盖 provider active cancel/interrupt、
  submit-intent 恢复、停止保留远端任务、双 worker GPU lease 互斥与退避上限。
- [x] 四路独立 review 与整改：最终 A/B/C/D = B+ / B- / B- / B；全部严重项关闭。

仍明确不做：M3 的 v2v/rv2v、视频/音频引用槽与批量镜头队列；任何 TTS、
配音、音乐、环境声、雨声、SFX 或后混音。
