# Module Map

> 派单前查这里定位归属。行数红线：UI 文件 250、service 300、route 模块 <10 endpoints。

## packages/protocol — Zod 协议（snake_case HTTP 契约，Protocol 1.1）
project / shot（含 semantic_references、opening/ending state）/ h3-job（lease、lock_snapshot、compiled_bindings、gate_override）/ common（asset）/ asset-manifest / mode / character / canvas / production-error（稳定错误码导出）/ version

## packages/project-store — SQLite 唯一写入口
- project-store.ts：facade（252 行，留意红线）；域 store：mode-operations+ModeStore、production-store（brief/lock）、character-store、TakeStore（representative）
- migrations.ts + migration-v4/v5/v13.ts：逐编号可恢复
- 域操作文件：project/shot/job(-lifecycle/-completion/-support)/asset/manifest/character(-reference)/canvas/binding-operations、generation-locks、store-guards、row-mappers（空串哨兵映射在此）

## packages/h3-provider
- binding-compiler.ts：纯函数编译语义引用→有序 binding（模式推导、组合/kind 校验）；dry-run 与 job 创建共用
- provider.ts / registry.ts：运行时 ProviderAdapter 注册器（与持久 Mode registry 职责分离，见 ADR）

## packages/task-engine — job 生命周期规则（lease 状态机）

## apps/api — 本地 HTTP（127.0.0.1:4187）
routes.ts（核心 9 endpoints）+ 域路由：canvas / character / asset（+manifest）/ mode / brief（+lock）/ shot-production（PATCH+compile dry-run）/ representative。api-error.ts 映射稳定错误码→HTTP。

## apps/studio — React+Vite（127.0.0.1:5174，/api 代理 4187）
- 画布：InfiniteCanvas / CanvasShotCard / CanvasCharacterCard + lib/canvas-layout.ts（viewport 纯函数）
- 面板：CharacterLibraryPanel / AssetLibraryPanel / ModeRegistryPanel / ProductionBriefPanel / ShotProductionEditor / planned+actual 列视图组件
- hooks：use-studio / use-canvas-nodes / useCharacters / use-assets / use-modes / use-production

## tests
- tests/unit：binding-compiler、canvas-layout、h3-bindings、job-state
- tests/integration：api.test.ts、production-start.test.ts（真实 HTTP + 真实 SQLite）
- packages/project-store/tests：store + job-recovery

## 部署/环境（这台机器 = GPU 盒，RTX 4090 48G）
- ComfyUI：8188=Krea（v0.27）、8190=H3（v0.30，MiniMaxH3ImageToVideo/ReferenceToVideo 节点在位）；两者共享显存，切换需 POST /free
- 公网：Studio 经反向隧道+中转机 nginx 暴露于 http://106.14.227.192:9994（Basic Auth huang；详见 memory relay-106-exposure-pattern）
