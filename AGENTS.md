# H3Storyboard engineering rules

## Product truth

H3Storyboard is a local-first director workbench. It keeps planned shots and generated results as separate records. The product must never overwrite a plan with an observed result or present a generated result as approved without an explicit QC verdict.

## Hard rules

1. Production code never contains a fallback added only to make tests pass.
2. HTTP/JSON contracts use `snake_case`; internal-only implementation may use camelCase.
3. IDs use `crypto.randomUUID()`.
4. Database writes complete before any in-memory projection is changed.
5. Every schema change is a numbered migration tracked in `schema_version`.
6. H3 prompt references and uploaded files must share one validated binding list. Never claim a video or audio reference in a prompt when it was not uploaded.
7. Integration tests use a real HTTP server and real SQLite database. Mocked provider tests belong under unit tests.
8. Any UI file above 250 lines, service above 300 lines, or route module with 10 or more endpoints must be split before adding features.
9. Errors use stable codes. Do not classify errors by matching message strings.
10. Existing user projects and assets are append-only by default. Destructive cleanup requires explicit confirmation.

## Audio invariant

- Final video may contain only audio samples already present in the original H3-generated output.
- Never add TTS, dubbing, voice cloning, music, ambience, rain, room tone, SFX, Foley, or synthetic noise.
- A generation job must persist whether it requests H3 native audio or silence. Worker configuration must not change that decision after the job is created.
- If H3 audio is unusable, the only allowed replacement is silence.

12. H3 prompts and production gates come from the `h3-film-studio` skill through `@h3storyboard/film-studio-bridge` (ADR 0003). Never hand-write an H3 prompt, never re-implement a gate, never copy rule text into this repository. Persist `film_studio_revision` with every job and take.

## Milestone gate

Before declaring a milestone complete:

- `pnpm check && pnpm build && pnpm test` pass.
- At least one real HTTP + SQLite integration test crosses the new behavior.
- Planned-vs-actual invariants and error paths are tested.
- Four independent reviews cover architecture, bugs, tests, and protocol alignment.
