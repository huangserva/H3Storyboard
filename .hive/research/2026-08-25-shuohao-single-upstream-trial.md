# shuohao-skills 单上游试跑索引

完整报告：

- [2026-08-25-shuohao-single-upstream-trial.html](../reports/2026-08-25-shuohao-single-upstream-trial.html)

## 裁决

只选 `shuohao-skills`，但只把 `novel-script` 的 Scene/Beat 数据形态和确定性质量门作为 P2 Script Studio 的唯一上游参考。其他仓库退出当前方案。

不能把 shuohao 原样装进 H3Storyboard：

- `novel-outline` 的 full 门强制 major 爽点早于末集出现，单集/电影无法通过；
- action beat 没稳定 ID，也不记录服装、位置、持物等起止状态；
- 时长按每个动作固定 2.5 秒粗估；
- 后续包含 TTS、soundscape、BGM，违反 H3-only audio；
- JSON 文件没有 H3Storyboard 所需的持久版本事务和不可变生成历史。

## 实测

- `novel-script checkup`：10/10 通过。
- `novel-script validate --outline --art`：通过；1 集、1 场、4 句对白，151.3 秒 / 176.5 秒目标。
- `novel-art validate`：通过。
- `novel-outline validate --stage skeleton`：通过。
- `novel-outline validate --stage full`：按预期失败，证明短剧硬编码边界。

## 试跑产物

- [README](artifacts/shuohao-script-trial/README.md)
- [outline](artifacts/shuohao-script-trial/rain-night-outline.json)
- [art](artifacts/shuohao-script-trial/rain-night-art.json)
- [script](artifacts/shuohao-script-trial/rain-night-script.json)

## P2 最小映射

- `episode`：可选；短剧启用，电影/单片不强制。
- `scene` → `ScriptScene`。
- action/dialogue flow → 带 UUID 的 `ScriptBeat` discriminated union。
- hook/major/爽点：下沉为可选 Genre Recipe，不进入核心协议。
- 角色/场景/光照/道具检查：绑定现有 Character/Asset/Scene。
- 新增逐 beat 状态和时长预算，再编译为可审阅的草稿 ShotPlan。
- 全程只允许 H3 原生声音或静音。
