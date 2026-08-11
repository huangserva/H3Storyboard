# ComfyUI H3 adapter contract 实现索引

- 日期：2026-08-11
- 任务：M1B-1
- user 报告：[`../reports/2026-08-11-comfyui-h3-adapter-contract.html`](../reports/2026-08-11-comfyui-h3-adapter-contract.html)
- 参考实现：`h3-film-studio/scripts/local_providers.py:56-253`，本地 clone，来源 commit `8693cc7`
- 现场：`http://127.0.0.1:8190`，ComfyUI `0.30.0`

## 结论

将已实跑的 Python submit/poll/graph 契约移植到 `packages/h3-provider`，但不把“节点存在”提升为“端到端已验证”。M1B-1 只建立 contract 级 client、I2V graph、硬校验和只读证据；真实提交、显存释放、视频下载与 Mode evidence 升级留在协调 GPU 窗口后的 M1B-3。

## 源码映射

| Python 蓝本 | TypeScript 落点 | 保留的语义 |
|---|---|---|
| `_comfy_upload` | `ComfyUIClient.uploadImage` | multipart `image` + `overwrite=true`，返回 server filename |
| `_comfy_submit` | `submitPrompt` | `{prompt, client_id}`，拒绝 HTTP 错误、node_errors、缺 prompt_id |
| `_comfy_poll` | `pollHistory` | bounded poll、execution error、timeout、completed-but-empty 拒绝 |
| `_first_output` / `_view_url` | `firstOutput` / `viewUrl` / `downloadOutput` | gifs→videos→images，URL query 编码，零字节拒绝 |
| `build_h3_i2v_graph` | `buildH3I2VGraph` | Director graph、LoRA 链、seed、尺寸/帧、timeline、可选音频 |
| `frames_for_duration` | `framesForDuration` | 24fps 时长对齐现场节点声明的 `17k+5` 网格 |

参考 Python 的旧 `FRAME_GRID` 注释/数组与现场 schema 默认 `124` 存在不一致；本实现服从任务铁律与 `/object_info` 的真实节点约束，使用 `(frames - 5) % 17 === 0`，因此 5 秒→124、15 秒→362。

## 稳定校验

- `H3_DIMENSION_INVALID`：宽高必须为正整数且 `% 32 === 0`。
- `H3_FRAME_GRID_INVALID`：帧数必须在 `17k+5`；时长换算默认 24fps 后取最近网格点。
- `H3_PROMPT_CN_AUDIO`：`Audio:` 行含 CJK 立即阻断。
- `H3_PROMPT_DIALOGUE_QUOTES`：`Dialogue:`/`台词:` 行含未放进 `「」` 的中文时仅 warning。
- HTTP/protocol/poll/output/download 分别有 `H3_COMFY_*` 稳定码；代码分支不匹配 message。

## 只读现场证据

`H3_COMFY_PROBE=1` 的测试只调用 `GET /object_info`。2026-08-11 探测结果 `ready=true`：

- `MiniMaxH3ImageToVideo`: present
- `MiniMaxH3ReferenceToVideo`: present
- `EmptyMiniMaxH3LatentAV`: present
- `MiniMaxH3Director`: present
- `UNETLoader`, `CLIPLoader`, `VAELoader`, `LoraLoaderModelOnly`: present
- `LoadImage`, `CreateVideo`, `SaveVideo`: present

同轮人工只读 `GET /system_stats` 显示 ComfyUI `0.30.0`、RTX 4090，探测时 free VRAM 约 11.3 GB。未调用真实 `/prompt`、`/upload/image` 或 `/free`；这些 POST 仅打本地随机端口 stub。

## 验证边界

- stub 使用真实 `http.createServer`，覆盖 upload→submit→poll→view/download→free 成功链，以及 submit 4xx、poll timeout、history 空 outputs、下载零字节。
- 节点 `present` 只证明安装/声明存在，不证明 model 文件组合、LoRA、显存预算、音视频结果质量或端到端出片。
- `free()` 是 M1B-2 的显存切换钩子，本轮没有在 8190/8188 调用。
- M1B-3 才能在协调窗口 POST 真 graph，并用结果升级 Mode evidence。
