# shuohao-skills 单上游试跑

输入来自用户现有的 `shanghai_rain_night` 项目：

- `story.json`：故事、叙事与四段 story beats
- `INTENT.md`：人物、顺序、服装、连续性和 H3-only audio 约束
- `shot_table.json`：14 个已执行镜头及 4,235 帧总时长

试跑只采用 `shuohao-skills/skills/novel-script` 的结构和确定性校验，不采用其 TTS、配乐、soundscape 或下游 H3 prompt。

## 目标

1. 把现有自由文本和执行表投影为结构化 action/dialogue beat；
2. 用现有成片帧数设定剧本目标时长；
3. 验证这一层能否成为 H3Storyboard `ScriptScene` / `ScriptBeat` 的候选上游；
4. 不修改现有 H3Storyboard 数据库或生产协议。

## 运行

```bash
node /Users/serva/development/shuohao-skills/skills/novel-outline/scripts/novel-outline.mjs validate rain-night-outline.json
node /Users/serva/development/shuohao-skills/skills/novel-art/scripts/novel-art.mjs validate rain-night-art.json
node /Users/serva/development/shuohao-skills/skills/novel-script/scripts/novel-script.mjs validate rain-night-script.json --outline rain-night-outline.json --art rain-night-art.json
```

## 结果

- `novel-script checkup`：10/10 质量门通过；1 集、1 场、4 句对白，预估 151.3 秒，目标 176.5 秒。
- `novel-art validate`：通过；场景锚点、光照和空景提示词合法。
- `novel-outline validate --stage skeleton`：通过。
- `novel-outline validate --stage full`：失败。单集项目无法满足“major 爽点必须早于最后一集首次出现”的短剧硬门；这不是样例错误，而是上游模型边界。

因此采用 `novel-script` 的 Scene/Beat 与确定性门禁，重写 H3Storyboard 自己的通用 Outline 协议；不把 shuohao 的短剧爽点、TTS、BGM 或 H3 prompt 直接引入。
