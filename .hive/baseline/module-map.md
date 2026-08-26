# Module Map

> 派单前查这里定位归属。行数红线：UI 文件 250、service 300、route 模块 <10 endpoints。

## packages/protocol — Zod 协议（snake_case HTTP 契约，Protocol 2.0）
script（Version/Scene/Beat/validation/compilation）/ project / shot（含 planning_status、script provenance、semantic_references、opening/ending state）/ h3-job（lease、lock_snapshot、compiled_bindings、gate_override、单镜/批量 preflight）/ common（asset）/ asset-manifest / mode / character / canvas（单条 CRUD + 批量 ensure）/ production-error / version

## packages/project-store — SQLite 唯一写入口
- project-store.ts：facade；域 store：ScriptStore（import/edit/validate/lock/compile）、mode-operations+ModeStore、production-store（brief/lock）、character-store、TakeStore（representative）
- migrations.ts + migration-v4–v24.ts：逐编号可恢复
- 域操作文件：project/shot/job(-lifecycle/-completion/-support)/asset/manifest/character(-reference)/canvas/binding-operations、generation-locks、store-guards、row-mappers（空串哨兵映射在此）

## packages/h3-provider
- binding-compiler.ts：纯函数编译语义引用→有序 binding（模式推导、组合/kind 校验）；dry-run 与 job 创建共用
- provider.ts / registry.ts：运行时 ProviderAdapter 注册器（与持久 Mode registry 职责分离，见 ADR）

## packages/task-engine — job 生命周期规则（lease 状态机）

## apps/api — 本地 HTTP（127.0.0.1:4187）
routes.ts（核心路由表）+ 域路由：script（7 endpoints）/ canvas（含 batch PUT）/ job（含 project batch preflight）/ character / asset（+manifest）/ mode / brief（+lock）/ shot-production / representative。api-error.ts 映射稳定错误码→HTTP。

## apps/studio — React+Vite（127.0.0.1:5174，/api 代理 4187）
- 画布：React Flow 的 StoryboardFlow / InfiniteCanvas / CanvasShotCard / CanvasCharacterCard / CanvasInspectorPanel + storyboard graph/lineage 纯函数
- 面板：ScriptStudio（Scene/Beat 编辑与版本轨）/ CharacterLibraryPanel / AssetLibraryPanel / ModeRegistryPanel / ProductionBriefPanel / ShotProductionEditor / planned+actual 列视图组件
- hooks：use-script-studio / use-studio / use-canvas-nodes（批量首载）/ use-generation-preflights（项目级批量轮询）/ useCharacters / use-assets / use-modes / use-production

## tests
- tests/unit：binding-compiler、canvas-layout、storyboard-graph、h3-bindings、job-state
- tests/integration：script-studio、api、batch-canvas-preflight、generation-entry、worker、media、production-start（真 HTTP + 真 SQLite）
- tests/e2e：真实 Chromium + API + Studio；100 镜双标签请求预算在 canvas.spec.ts
- packages/project-store/tests：store + job-recovery

## 部署/环境（这台机器 = GPU 盒，RTX 4090 48G）
- ComfyUI：8188=Krea（v0.27）、8190=H3（v0.30，MiniMaxH3ImageToVideo/ReferenceToVideo 节点在位）；两者共享显存，切换需 POST /free
- 公网：Studio 经反向隧道+中转机 nginx 暴露于 http://106.14.227.192:9994（Basic Auth huang；详见 memory relay-106-exposure-pattern）
