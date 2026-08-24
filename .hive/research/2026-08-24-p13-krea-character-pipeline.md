# P1.3 Krea2 / Qwen 角色参考图链路调研索引

- 日期：2026-08-24
- 完整报告：[`../reports/2026-08-24-p13-krea-character-pipeline.html`](../reports/2026-08-24-p13-krea-character-pipeline.html)
- 调研范围（只读）：
  - `/Users/serva/development/h3-film-studio` @ `963c4ff4cc12383d7be2b26b21df4dbf1750e4f5`
  - `/Users/serva/development/xyz-video-skill` @ `06837a0353d8efa8cad990869a85a6e7426f11f7`
  - `/Users/serva/development/director` @ `cb7358b637c4cb2d03993a68a92e3a654a81a153`
  - 当前 H3Storyboard 工作树（协议与接入面）
- 本次没有调用 ComfyUI、没有访问 4090、没有生成素材，也没有读取或接入任何 TTS/BGM/环境声链路。

## 一句话结论

可以做成 H3Storyboard provider，但不能原样复制 `h3-film-studio` 的 `local_krea`：它目前只有 Krea2 T2I，虽然函数收到了 `characters_in_shot`，graph 并未使用任何角色参考。真正的身份锁是独立的 Qwen-Image-Edit-2511 脚本；Krea i2i 也是另一条一次性 runner。P1.3 应把三种操作拆成显式、可恢复、可审计的 image job：`master_t2i`、`identity_edit`、`variant_i2i`。

## 已核实事实

### 1. Krea2 T2I：有 provider 接口，但没有身份锁

- Mac SSH 隧道默认 `http://127.0.0.1:18188`，盒上直连 8188；配置位置：`h3-film-studio/config/providers.yaml:87-97`，脚本默认值：`scripts/krea_t2i.py:12`。
- graph：
  - UNET `krea2_turbo_fp8.safetensors`
  - CLIP `qwen3vl_4b_fp8_scaled.safetensors`，type=`krea2`
  - VAE `qwen_image_vae.safetensors`
  - 可选/现有默认 LoRA `krea2_lora 通行证刀斧手版.safetensors`
  - KSampler：8 steps、CFG 1.0、`euler_ancestral`、`sgm_uniform`、denoise 1.0
  - 源码：`h3-film-studio/scripts/krea_t2i.py:52-108`；provider 重复实现：`scripts/local_providers.py:256-275`。
- CLI runner 用 `master_seed + shot index + seed_offset`，会保存每镜 seed、prompt、prompt_id：`scripts/krea_t2i.py:186-276`。
- 通用 provider 的 `_seed_for()` 使用 Python `hash(output.name)`：`scripts/local_providers.py:50-51`。Python hash 默认跨进程随机，不能作为可重放 seed。
- `image_krea()` 的参数包含 `storyboard`、`characters_in_shot`、`scene_image`，但 graph 只收到 prompt/seed/尺寸/LoRA；参考图没有上传、没有 LoadImage/VAEEncode、没有参考 conditioning：`scripts/local_providers.py:278-314`。因此它不能宣称“角色参考生成”。
- `image_gen.py` 同 provider 最多重试后会继续 fallback，最终生成 placeholder 并返回成功形态：`scripts/image_gen.py:63-123`。H3Storyboard 不应复制这种失败语义。

### 2. Qwen-Image-Edit-2511：是真正的参考图身份锁原型

- endpoint 同为 Krea ComfyUI 隧道 18188；入口、固定 480×864：`scripts/qwen_edit_identity.py:8-9`。
- 模型：
  - UNET `qwen_image_edit_2511_fp8_lightning_4steps.safetensors`
  - CLIP `qwen_2.5_vl_7b_fp8_scaled.safetensors`，type=`qwen_image`
  - VAE `qwen_image_vae.safetensors`
  - `ModelSamplingAuraFlow(shift=3.1)` → `CFGNorm(strength=1)`
  - `TextEncodeQwenImageEditPlus` 接 image1，最多再接 image2
  - `FluxKontextMultiReferenceLatentMethod(reference_latents_method=index_timestep_zero)`
  - KSampler：4 steps、CFG 1.0、Euler、simple、denoise 1.0
  - 源码：`scripts/qwen_edit_identity.py:49-80`。
- image1 会经过 `FluxKontextImageScale`，同时被 VAEEncode 作为 latent；image2 直接进入 Qwen encoder：`scripts/qwen_edit_identity.py:58-77`。
- 任务协议已经具备 ComfyUI 的上传 → `/prompt` → `/history/:id` → `/view`，识别 `node_errors` 与 history error，600 秒超时：`scripts/qwen_edit_identity.py:21-46,83-132`。
- seed 明确为 `2026081300 + index*7`：`scripts/qwen_edit_identity.py:179-195`。
- 项目复盘记录 2026-08-09 人工验证“跨 seed 脸、网巾/胡须、白袍/发髻一致”，并明确禁止只靠文字 bible：`reference/INTENT-jinpingmei.md:138-146`；2026-08-11 验收再次记录人物/服装一致：同文件 `182-195`。
- 限制：脚本硬编码角色、路径和 prompt；W/H 常量没有真正进入 graph；没有 request manifest、输入 hash、稳定错误码、任务恢复与取消。

### 3. Krea2 i2i：单 master 派生已经跑过，但不是通用 provider

- `build_i2i()` 使用同一 Krea2/CLIP/VAE/LoRA，`LoadImage → VAEEncode → KSampler`：`scripts/krea_nude_realistic.py:162-179`。
- 已跑参数不是 0.42：S6/S7/S9/S10/S12 初始 denoise 分别为 0.56/0.60/0.60/0.58/0.52；seed=`2026081901 + index*19`，重抽 `+ attempt*37`；源码：`scripts/krea_nude_realistic.py:236-265`。
- runner 先用 S5 T2I 作为 master，再让其他图只从该 master 派生；以肤色亮度差 ≤16 作为自动停止条件，最多三次：`scripts/krea_nude_realistic.py:236-270`。
- 现存 6 张输出位于 `/Users/serva/Desktop/jinpingmei_i2v/full_8v8a/qwen_nude_s5s12/`，均为 480×864 PNG，mtime 2026-08-18/19；脚本会写入该目录：`scripts/krea_nude_realistic.py:12-15,193-200`。但脚本没有保存 prompt_id/request manifest，所以这是“代码、路径、时间与成品互相吻合”的强相关证据，不是可复核的加密 provenance。
- 文档另记“普通角色主图派生 denoise 0.42”：`reference/h3-prompt-discipline.md:18-20`。本仓库没有对应 0.42 的可运行脚本或 manifest，因此只能标成待 A/B 的 documented heuristic，不能写成已由当前代码验证。

### 4. xyz-video-skill 与 director 提供的正确部分

- xyz 的优点是 provider dispatch 形状和 reference usage：角色路径会解析成 `reference_character`，并保留 source/subject：`xyz-video-skill/scripts/reference_builder.py:54-75,228-333`。
- xyz 的缺点是失败后跨模型 fallback/placeholder，可能把风格漂移或假成功带进资产库：`xyz-video-skill/scripts/image_gen.py:62-115`。H3Storyboard 必须失败显式化，不能入 candidate Asset。
- director 给出的参考图产品规则可直接用于 UI 验收：关键人物一人一张、无遮挡、正面或自然 3/4 视角优先；只有剧情需要才补背/侧/表情/换装：`director/references/character-reference-image-guide.md:3-24`。

## 推荐的 P1.3 最小产品链

1. **上传或 Krea2 T2I 出候选母图**：每次生成 N 个 candidate，保存显式 seed；通用角色默认不加载“刀斧手”成人 LoRA，LoRA 必须由 Mode/profile 显式选择。
2. **人工批准唯一 master**：只有 approved image Asset 才能成为正式 CharacterReference；继续沿用现有 `candidate → approved → archived` 与 replacement 规则。
3. **从 approved master 派生**：
   - 默认身份/换装/构图编辑：Qwen `identity_edit`，1–3 张 approved reference。
   - 同场景轻改姿态/景别：Krea `variant_i2i`。一般角色可从 denoise 0.42 开始 A/B；大姿态参考已跑脚本的 0.52–0.60，但每张仍只进 candidate，必须人工审。
4. **批准派生图并冻结 manifest**：H3 `reference_character` 只解析 approved 且已进入当前 frozen manifest 的资产；旧 master 不在 replacement 获批前失效。
5. **画布展示 provenance**：provider/model、seed、steps、sampler/scheduler、denoise、LoRA/profile、source reference、prompt、content hash、Comfy prompt id、状态/error code 全部可见。

## 推荐 provider contract

不要把图片任务塞进只允许 `t2v/i2v/fl2v/r2v/v2v/rv2v` 且输出视频的 `H3Job`（`packages/protocol/src/h3-job.ts:12-23,75-106`）。新建独立 `CharacterImageJob`：

```text
operation: master_t2i | identity_edit | variant_i2i
provider: local_comfyui
engine: krea2 | qwen_image_edit_2511
project_id / character_id / idempotency_key
prompt / seed / width / height / steps / cfg / sampler / scheduler
denoise? / lora_profile? / lora_name? / lora_strength?
source_reference_ids[] / immutable input hashes
status / attempt / lease_token / provider_client_id / provider_job_id
output_asset_id / output_reference_id
error_code / error_message / timestamps
```

Provider 行为：`prepare → preflight → persist submit intent → submit once → recover/poll same task → download temp → decode/dimension/nonempty/hash verify → atomic rename → single SQLite transaction create candidate Asset + CharacterReference lineage + complete job`。完成不等于批准。

稳定错误至少区分：`IMAGE_INPUT_MISSING`、`IMAGE_CAPABILITY_MISMATCH`、`IMAGE_COMFY_QUEUE_BUSY`、`IMAGE_GPU_INSUFFICIENT`、`IMAGE_COMFY_HTTP`、`IMAGE_COMFY_NODE_ERROR`、`IMAGE_COMFY_TIMEOUT`、`IMAGE_OUTPUT_MISSING`、`IMAGE_OUTPUT_INVALID`。禁止 bool+warning 后生成 placeholder。

## 显存与并发纪律

- Krea 8188 与 H3 8190 共用 4090；旧项目规则要求切换前只对自己实例 `POST /free`，绝不 kill 他人进程，并在提交前检查约 17GB 可用显存：`h3-film-studio/AGENTS.md:24-34`。
- 现有图片脚本会吞掉 `/free` 异常继续跑，且不检查另一 endpoint 的队列：`qwen_edit_identity.py:110-123`、`krea_nude_realistic.py:82-86,134-140`。生产 provider 不可照搬。
- H3Storyboard 应增加按 `gpu_host` 的共享 SQLite lease，使 H3 worker 与 image worker 互斥；提交前查两端 queue/system stats。占用时返回 recoverable busy，不 `/free`、不上传、不提交。
- `/free` 只作用于配置为本项目所有的 endpoint；失败就终止本次提交。取消只取消本 job 的 prompt id，不做全局 interrupt，不 kill ComfyUI。

## 当前协议可复用与缺口

- 可复用：Character/CharacterReference lineage（`packages/protocol/src/character.ts:56-104`）、Asset 生命周期与 replacement（`packages/project-store/src/asset-operations.ts:53-143`）、approved manifest、媒体 route、现有 H3 worker 的 submit-intent/recovery/atomic completion 纪律。
- 必须补：project-level batch references endpoint，避免当前 `GET /characters/:id/references` 的 N+1（`apps/api/src/character-routes.ts:14-44`）；图片 upload；image job/schema/store/worker；参考卡的 provenance 与批准入口。
- CharacterReference 目前没有独立 status，这是可以接受的：候选/批准状态由其 linked Asset 决定；`derived_from` 记录同角色 reference lineage。不要再发明一套并行审批状态。

## 禁止带入

- 不接 `xyz-video-skill` 或 `h3-film-studio` 的 TTS、BGM、Foley、环境声或跨模型声音 fallback。
- 图片 provider package 不依赖 video/audio config；输出 kind 只能是 `image`。
- 本调研仅讨论角色参考图，H3 视频继续只允许 `h3_native | silent`，外部音频绑定继续由现有协议拒绝。

## 风险与待验证

- 0.42 是文档启发，不是当前可运行证据；正式默认前应在同一 master/prompt/seed 族上做 0.35/0.42/0.50 A/B，人工比较脸、服装、姿态自由度。
- “刀斧手”是特定成人 profile，不应成为所有角色的默认 LoRA；通用无 LoRA Krea graph 需要独立 smoke。
- Qwen image2 没走 `FluxKontextImageScale`、W/H 未显式约束；多参考不同尺寸需真实 graph smoke。
- 旧成品没有 prompt_id/request manifest，不能导入后伪装为 fully reproducible job；只能作为 legacy reference Asset 标注来源未知。
