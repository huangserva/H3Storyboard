# Decision: versioned Script Studio compiles only reviewable draft Plans

Date: 2026-08-26
Status: accepted

## Context

The legacy `ScriptVersion` was only a locked text envelope. The selected
Shuohao upstream supplies a useful Scene/Beat shape but not H3Storyboard's
version transactions, stable identities, production lineage, or audio policy.

## Decision

- H3Storyboard owns `ScriptVersion -> ScriptScene -> ScriptBeat` in SQLite.
- Plain text and Shuohao JSON are import formats, not runtime dependencies.
- Draft is the only editable ScriptVersion state. Locking supersedes the prior
  active locked version; locked/superseded documents never change.
- Whole-document draft writes require the version's expected revision. The
  revision increments transactionally, so a stale browser receives a conflict.
- Deterministic compilation creates new `planning_status=draft` ShotPlans and
  persists exact Scene/Beat/compilation provenance.
- A locked script version has at most one compilation. Same idempotency key
  replays the result; another key conflicts.
- Draft Plans cannot create single or batch H3 jobs. Director approval belongs
  to the next explicit review step and must never be inferred from compilation.
- Script Studio never calls ComfyUI and never creates TTS or external audio.
- Costume, position, and prop maps survive compilation as structured Plan
  fields; they are not discarded or misrepresented as resolved Character IDs.

## Consequences

Old generation history remains auditably attached to the script version and
beats that produced it. The canvas can test compiled output now without risking
GPU work. P2.2 must add a director review/edit/approve transition before these
plans can enter the existing H3 execution pipeline.
