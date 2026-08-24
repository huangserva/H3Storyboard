# Runtime Flows

> 主要的运行时数据流，让 orch 一眼看清"消息从哪来、经过谁、到哪去"。

## Flow 1: 画布首载与布局持久化

```
ProjectSnapshot.shot_plans
  -> Studio 计算缺省坐标 / 读取一次性 legacy localStorage
  -> PUT /api/projects/:id/canvas_nodes（单请求，受 1 MB JSON body 限制）
  -> ProjectStore immediate transaction
       先验证全部引用 -> INSERT ON CONFLICT DO NOTHING
       -> 仅未被拖动的 legacy 行可迁移 x/y
  -> 返回完整 canvas_nodes（含 character）
  -> React Flow 派生完整业务图
```

拖拽只 PATCH 当前 anchor node；每节点串行队列避免旧响应覆盖新位置，失败立即回滚 UI。

## Flow 2: 生成就绪检查

```
Studio 每 5 秒一次 GET /api/projects/:id/jobs/preflights
  -> API 一次读取 snapshot / lock / briefs 并预索引 jobs、代表 Take、assets
  -> 按 shot ordinal 编译各镜 binding
  -> 每镜返回 ready 或稳定 blocking_error
  -> Studio 原子替换 shot_id -> preflight Map
```

项目切换或 hook 重建会 abort 旧请求；同一轮询周期不允许请求重叠。

## Flow 3: H3 Job 到 Take

Studio create job -> SQLite immutable draft -> lease worker claim -> ComfyUI
submit/poll/download -> 同一 immediate transaction 创建 candidate video Asset、
completed H3Job、pending ShotActual -> Studio snapshot 刷新 -> 显式 QC / 代表 Take。
最终音频只能是 H3 原始输出音轨或静音。

## Flow 4: 本地画布体验项目

```
pnpm demo:canvas
  -> 幂等 seed 独立 canvas-test.db
  -> 校验 MP4 有 video handler 且无 audio handler
  -> 用真实 Store 生命周期建立 completed Job / Take / QC
  -> H3_WORKER=0 启动 API + Studio
  -> Range 媒体端点 -> 画布卡片 / Inspector / Lightbox
```

此链路不调用 ComfyUI/4090；两段演示 Take 永远静音。
