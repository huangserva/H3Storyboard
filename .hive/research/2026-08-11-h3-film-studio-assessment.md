# h3-film-studio 参考评估索引

- 完整报告：[`../reports/2026-08-11-h3-film-studio-assessment.html`](../reports/2026-08-11-h3-film-studio-assessment.html)
- 调研日期：2026-08-11
- 来源：`github.com/huangserva/h3-film-studio`，检视 commit `8693cc7`（浅克隆）。自家项目（fork 自 xyz-video-skill），无许可证顾虑。
- 本地 skill 目录在 user 的 Mac：`~/.claude/skills/h3-film-studio/`；本机（Linux）不存在。项目现场素材在 user Mac `~/Desktop/jinpingmei_i2v/`。

## 问题

user 让看 h3-film-studio 对 H3Storyboard 有什么可借鉴的。它是四个参考源里唯一真正端到端跑通本地 MiniMax-H3 出片的（119s 成片、视频音频双流）。

## 核心判断

它是 **M1B ComfyUI adapter 的直接蓝本 + Q2 角色定义的最强输入**。借它被实证过的工程事实（契约、参数、映射、纪律），不借它的 skill 文档式流程——无持久化、无 planned/actual 分离正是 H3Storyboard 要补的。

## 可验证证据

1. ComfyUI 契约：`scripts/local_providers.py`（314 行）— `POST /prompt` 提交 graph、`GET /history/{pid}` 轮询、view URL 下载、i2v graph builder、LoRA 注入、seed 派生。fl2v graph 在 `scripts/fl2v_build.py`。
2. 三模式映射（HFS_P1_NOTES.md）：`first_frame`→i2v、`reference_character/prop/stage`→r2v、`reference_target_state`→fl2v。P1 冒烟已验证 i2v 双流出片（turbo 4 步 ~80s/124f/480×864）。
3. 角色一致性三重锚（reference/h3-prompt-discipline.md）：角色 bible 逐字复述（每张母图不许省）+ 空间锚 + 同 seed 族；更强锁 = Krea i2i 从角色主图派生（denoise 0.42）。
4. H3 硬约束（实验确证 2026-08-09）：宽高 ÷32；帧数 17k+5；**中文 Audio 行会被整句念出来**（含"无人声"类禁声句），台词写「」+ 指明说话人，Audio 行仅英文或不写；T8 采样 video_steps=4 / audio_steps=8。
5. 运维坑：Krea(8188)/H3(8190) 共享显存，切换前 `POST /free`；糊音 = seed 抽卡，换 seed 重跑。
6. INTENT 协议（reference/intent-protocol.md）：文件化单一真相源 + 纠正即写用户原话 + 动手前必读 + 交付自检门 → M1A production brief 的文件版原型。
7. 母图派生连贯法：一张高清母图 ffmpeg 裁多景别，视线/空间/光线天然一致；跨场用同空间描述前缀 + 同 seed 族。
8. providers.yaml：`local_h3` 能力声明（supports_multi_reference、max_reference_images=6、generate_audio、min/max duration）已是 Mode 能力表的雏形。

## H3Storyboard 决策

- 采纳：ComfyUI submit/poll 契约照抄成 TS adapter（M1B）；三模式↔reference 用途映射入协议枚举（M1A）；H3 硬约束编译成 provider 校验 + prompt lint（稳定错误码）；ShotActual 记录音频流 + QC 听查维度；rerun 原因加 `audio_garbled`；资产血缘支持母图→裁切派生。
- 角色实体最小字段（回答 Q2 的证据）：规范外观文本（逐字注入 prompt）、参考图集、seed 族、派生血缘；服装/造型状态机后置。
- 不采纳：skill 流程本身；具体参数当常量（进 Mode candidate/validated 能力表）；内容 profile 细节（profile 机制维度保留）。

## 影响

- plan.md：M1A 角色定义、M1B adapter 的设计输入已备齐；不改里程碑结构。
- Q2 可以基于证据答复（已在 open-questions 附证据指针）。
- 后续 M1B 实施时如需对照实跑环境，H3 ComfyUI 在 GPU 盒 8190、Krea 8188（user Mac 经隧道 18190/18188）。
