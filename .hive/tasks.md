# Tasks

## In progress

### Sprint · M1A 导演级生产契约（2026-08-11 启动）
M1A 拆五刀顺序推进，每刀一个 dispatch、独立可验收、完成即 commit：
1. ✅ M1A-1 角色一等实体（migration v7，Q2 ADR 定字段）
2. ▶️ M1A-2 资产生命周期 + current-assets manifest（migration v8）
3. ⏳ M1A-3 Mode registry（candidate/validated 能力状态；r2v-hybrid 将是首个 candidate）
4. ⏳ M1A-4 production brief 版本化 + 项目生成锁 + job 锁快照
5. ⏳ M1A-5 per-shot 语义引用 → 有序 H3 binding 编译 + 代表性 take 审批门
前置决策已锁：shot=生成段（ADR 方案 A）；角色最小字段（ADR Q2）。

- [ ] **全栈工程师** dispatch `3900177d` — 任务：M1A-2——资产（Asset）生命周期 + 权威 current-assets manifest。设计依据：.hive/research/2026-08-11-director-reference-assessment.md（资产…

## Done

### 2026-08-11 · M2 画布提前批
- [x] **全栈工程师** dispatch `34a29e50` — 画布原型 + 106 nginx/临时隧道；安全组已由 user 放行，systemd unit 待 sudo 安装（Q4）。
- [x] **全栈工程师** dispatch `0213387b` — 画布第二轮：SQLite v6 canvas_nodes、CRUD、旧布局迁移、zoomToNode、复位和 z-index（commit 2c4359c）。
- [x] **全栈工程师** dispatch `fe091938` — M1A-1 角色实体、参考图血缘、归档 CRUD、角色库与画布节点（commit 8174da0）。
