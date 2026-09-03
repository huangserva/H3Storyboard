# ADR 0003: h3-film-studio is a component of H3Storyboard

- Status: accepted
- Date: 2026-08-25

## Context

`h3-film-studio` (`~/.claude/skills/h3-film-studio`, github.com/huangserva/h3-film-studio) is where every H3 production rule that has been validated on real output lives: the INTENT protocol, the pose state machine and its `preflight_continuity.py` gate, the character identity lock, T8 multi-rate audio parameters, and, as of 2026-08-25, the compiler that emits prompts in MiniMax's official `VIDEO_PROMPT_WRITING_GUIDE` format. A controlled experiment (same master image, same seeds, only the prompt format changed) removed all three chronic defects: garbled speech, burned-in subtitles, and silent shots whose mouths moved.

H3Storyboard M0 owns durable planned/actual shots, jobs, takes, QC, and the Studio shell. Until now it referenced none of the above; the two repositories were evolving as two systems. Product owner decision: h3-film-studio is a part of H3Storyboard, and not referencing it means building the same thing twice.

### Supersedes part of the 2026-08-11 assessment

`.hive/research/2026-08-11-h3-film-studio-assessment.md` decided to borrow the skill's "proven engineering facts" and compile its H3 constraints into provider validation and a prompt lint inside this repository. Its fact 4 (dialogue in 「」 quotes, English-only Audio lines) was the state of knowledge on 2026-08-11 and is now known to be wrong: MiniMax's official guide requires `<d>[Chinese] …</d>` with `(S1)` speaker ids and an all-English body, and the 2026-08-25 controlled experiment showed the 「」 form is what produced garbled speech and burned subtitles. A copied rule went stale in two weeks. That is the concrete reason this ADR forbids copying rules and makes the skill a runtime dependency instead. The assessment's other adoptions (ComfyUI submit/poll contract as a TS adapter, mode↔reference mapping, asset lineage) stand.

## Decision

Treat `h3-film-studio` as a **component dependency**, in contrast with ADR 0002, where `director` is only a policy reference.

1. `@h3storyboard/film-studio-bridge` is the only way H3Storyboard talks to the skill. It resolves the checkout (`H3_FILM_STUDIO_DIR`, default `~/.claude/skills/h3-film-studio`), invokes `scripts/h3_prompt_compiler.py --json` and `scripts/preflight_continuity.py`, and records the skill's git revision on every result.
2. H3Storyboard never hand-writes an H3 prompt and never re-implements a production gate. Rule text, prompt grammar, and gate logic change only in h3-film-studio.
3. The M1 provider worker builds `ProviderSubmission.prompt` exclusively from `compilePrompt()`. A job whose prompt did not come through the bridge is a protocol error.
4. Every persisted H3 job and take stores `film_studio_revision`, so a result can be traced to the exact rule set that produced it.
5. The skill's QC gates (preflight now; subtitle, voice, and spectrum gates as they land) surface in Studio as QC status, not as reimplemented checks.

## Consequences

- A missing or moved skill checkout fails fast with `FILM_STUDIO_NOT_FOUND`; there is no silent fallback prompt.
- Interface changes in the skill's scripts break `tests/unit/film-studio-bridge.test.ts` here; that coupling is intended.
- Python 3 must be available where the API/worker runs. The bridge does not vendor the skill; pinning it as a git submodule is a separate decision once M1 is real.
- ADR 0002's Mode/policy model stays. Modes may declare which h3-film-studio gates they require, but the gates themselves are not duplicated.

## Provenance

Bridge introduced against h3-film-studio commit `db04548` (official prompt compiler plus the 6/6 controlled A/B). No skill source was copied into this repository.
