# ComfyUI_MinimaxH3HybridLoader 评估索引

- 完整报告：[`../reports/2026-08-11-h3-hybrid-loader-assessment.html`](../reports/2026-08-11-h3-hybrid-loader-assessment.html)
- 调研日期：2026-08-11
- 来源：`github.com/scottmudge/ComfyUI_MinimaxH3HybridLoader`，检视 commit `861c7df`。MIT 许可。单节点 custom node（minimaxh3.py 552 行）+ 逐 tensor 对比分析文档。

## 问题

user 问这个仓库对 H3Storyboard 有没有帮助。

## 关键事实

1. MiniMax 发了两个权重布局相同的 H3 checkpoint：`fl2va`（首尾帧条件，官方承认质量更高）和 `ref2va`（多模态参考条件，但有确认的训练质量问题）。**这解释了 r2v 出片质量差的根因——是权重问题，不是 prompt/参数问题。**
2. 逐 tensor 对比（932 tensors）：两 checkpoint 约 97% 权重位相同或 cosine ≥0.9997；分歧集中在每 block 的 `adaln_proj.linear.*`（模态调制投影，cosine 甚至为负）——正是 ref2va 为参考条件重训的部分。
3. 该节点做混合加载：fl2va 为 base（高质量注意力/MLP/输出头），只把 ref2va 的 adaln_proj 叠上去（保留参考条件通路）。作者实测推荐：`block_range_adaln` preset，blocks 30–49。
4. 工程质量：mmap 流式合并（峰值内存 ≈ 单模型 19.5GB 而非 2×）、只读、量化感知（int8 .comfy_quant 伴随迁移）、与 stock `Load Diffusion Model` 行为兼容。
5. 使用：拖进 `ComfyUI/custom_nodes/` 重启即可，节点出现在 model/loaders。

## H3Storyboard 决策

- **M1B r2v 路径直接受益**：h3-film-studio 待办里"打开 r2v 模式"可用此获得 fl2va 级质量 + 参考条件能力。GPU 盒（H3 ComfyUI 8190）装上后，provider 的 r2v graph 把 loader 节点换成 `MiniMaxH3HybridLoader`（base=fl2va，overlay=ref2va，block_range 30–49）。
- **Mode registry 的活教材**：`r2v-hybrid` 应作为 `candidate` Mode 录入，capability 声明含 loader preset + block range；跑过对照实验后升 `validated`——正好走一遍 M1A 设计的验证状态机。
- 需要真 GPU 验证（两个 checkpoint 各 ~19.5GB 都要在盒上），属 M1B 实施期任务，现在不派。
- MIT 许可，可自由使用；不需要复制代码进本仓库，作为 GPU 盒的 custom node 部署即可。

## 影响

- plan.md M1B 增加一条：hybrid loader 对照验证（fl2va vs ref2va vs hybrid 同 prompt/seed 三方对比）。
- 不改协议。与 shot-vs-segment 边界决策无关。
