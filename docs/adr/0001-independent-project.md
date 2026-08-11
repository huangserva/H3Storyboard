# ADR 0001: Build H3Storyboard as an independent project

- Status: accepted
- Date: 2026-08-11

## Decision

Create a new repository instead of modifying `xyz-video-creator` or forking `filmstoryboard`.

`xyz-video-creator` contributes user-owned protocol concepts. `filmstoryboard` contributes workflow evidence and interaction references only.

## Reasons

- H3Storyboard requires a new root model: planned shots and actual generated shots are separate.
- H3 modes and reference bindings must be first-class contracts.
- The existing xyz application has broader cloud video, authentication, speech, music, and composition concerns that would distort the first milestone.
- `filmstoryboard` currently has no open-source license and contains very large UI/controller modules.

## Consequences

- Initial velocity is spent on clean protocol and storage boundaries.
- Existing xyz providers can be adapted later through explicit interfaces.
- No source is copied from `filmstoryboard` without a separate license decision.
