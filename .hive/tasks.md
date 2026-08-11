# Tasks

## In progress

### Sprint · M1B 单镜 H3 闭环（2026-08-11 启动）
本机即 GPU 盒（4090 48G，8190=H3 / 8188=Krea，共享显存）。三刀顺序推进：
1. ▶️ M1B-1 ComfyUI adapter（contract 级：submit/poll/graph builder/提交前校验/prompt lint/只读能力发现；零真实生成）
2. ⏳ M1B-2 lease worker：submit-once/poll/恢复 + 下载/hash/canonical 资产注册/pending take（顺带清理 content_hash 空串哨兵，ADR 欠账）
3. ⏳ M1B-3 真机出片 + r2v-hybrid 三方对照（装 HybridLoader 需重启 ComfyUI，**须与 user 协调 GPU 窗口**）
门禁：每刀四路 review 纪律沿用；真实生成前必须项目锁 + brief + manifest（M1A 契约）。

- [x] **全栈工程师** dispatch `478c3bf6` — 任务：M1B-1——ComfyUI H3 adapter（TypeScript，contract 级）+ 只读能力发现。蓝本：h3-film-studio 的 scripts/local_providers.py

- [x] **全栈工程师** dispatch `d5958f44` — 任务：M1B-2——H3 provider lease worker：submit-once / poll-same-task / 恢复 + 完成管线（下载→非空校验→hash→canonical 资产注册→pending take）。蓝…
## Done

### 2026-08-11 · M1A 导演级生产契约（done，commit 70d83c7 收官）
六刀 + review 整改全部完成；四路 review（架构 B+/缺陷 9+1 findings 修复/测试 A-/协议 1.1 补齐）通过：
- [x] **全栈工程师** dispatch `fe091938` — M1A-1 角色实体（migration v7，commit 8174da0）
- [x] **全栈工程师** dispatch `3900177d` — M1A-2 资产生命周期 + immutable manifest（v8，d2490e3）
- [x] **全栈工程师** dispatch `90ba2bd7` — M1A-3 Mode registry（v9，ee35ccf）
- [x] **全栈工程师** dispatch `28cb8a14` — M1A-4 brief + 生成锁 + job 锁快照（v10，33d9845）
- [x] **全栈工程师** dispatch `6cabf28d` — M1A-5 语义引用 + 起止状态 → binding 编译（v11，58fc506）
- [x] **全栈工程师** dispatch `f8822e0a` — M1A-6 代表性 take 门禁（v12，fe3e62c）
- [x] **全栈工程师** dispatch `d584aa6c` — 四路 review 整改 F1–F10 + Protocol 1.1 文档 + store 拆分（v13，70d83c7）

### 2026-08-11 · M2 画布提前批
- [x] **全栈工程师** dispatch `34a29e50` — 画布原型 + 106 nginx/临时隧道；安全组已由 user 放行，systemd unit 待 sudo 安装（Q4）。
- [x] **全栈工程师** dispatch `0213387b` — 画布第二轮：SQLite v6 canvas_nodes、CRUD、旧布局迁移、zoomToNode、复位和 z-index（commit 2c4359c）。
