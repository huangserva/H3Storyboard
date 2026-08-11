# ADR: 角色实体最小字段集（Q2）

- 日期：2026-08-11
- 状态：accepted（user 当日拍板）
- 关联：.hive/research/2026-08-11-h3-film-studio-assessment.md · plan.md M1A

## 背景

H3Storyboard 需要角色作为一等实体（user 愿景三要素之一）。h3-film-studio 的《金瓶梅》实跑给出实证：人物一致性靠"角色 bible 逐字复述 + 空间锚 + 同 seed 族"三重锚，缺一漂移；Krea i2i 从角色主图派生（denoise≈0.42）锁脸最稳。

## 决策

角色实体 M1A 最小字段集：

1. **规范外观文本**（canonical appearance）——可逐字注入每条生成 prompt 的英文描述，是一致性的第一锚
2. **参考图集**——关联资产（主形象图等），走资产生命周期
3. **seed 族**——角色绑定的 seed 集合，跨镜生成复用
4. **派生血缘**——参考图之间的派生关系（母图→i2i 派生），追溯身份来源

服装状态/多造型（revision）状态机**后置**，不进 M1A。

## 理由

四个字段直接对应实证的三重锚 + 派生锁；状态机在单造型片子里用不上，提前建模是投机。

## 已知代价

- 换装/多造型剧目要等后续版本；届时需要 revision 模型和迁移。
- 规范外观文本以英文为主（H3 prompt 纪律），中文剧本侧需要一次翻译/固化步骤。

## 结果

commit `8174da0` 已落地 protocol `Character` / `CharacterReference` schema、SQLite migration v7、稳定错误码与真实 HTTP CRUD；角色引用支持自引用派生血缘并拒绝缺失、跨项目和循环来源。Studio 提供角色库与 character canvas node。服装/多造型状态机未建模，per-shot 语义绑定留后续 M1A。
