# Architecture

## Boundaries

H3Storyboard is not a merger of existing applications or skills. It owns a fresh runtime, imports only user-owned protocol ideas from `xyz-video-creator`, treats `filmstoryboard` as a product benchmark, and uses the MIT-licensed local `director` project as a production-policy reference. None is a runtime dependency.

```text
studio UI
   |
production policy
   +-- mode registry + validation status
   +-- generation locks + quality gates
   +-- semantic reference requirements
   |
local HTTP API
   |
application services
   +-- project-store (SQLite)
   +-- task-engine (durable lifecycle)
   +-- h3-provider (execution boundary)
   |
protocol (single JSON contract)
```

## Invariants

1. A `shot_plan` can exist without a generated result.
2. A `shot_actual` always points to the exact H3 job and output asset that produced it.
3. An actual result is not accepted until `qc_verdict = approved`.
4. H3 input bindings are typed assets, not prompt-only annotations.
5. Every job stores its prompt, mode, model, seed, steps, input bindings, and lifecycle events.
6. Local ComfyUI and cloud MiniMax are providers behind the same validated contract, not separate product flows.
7. Provider callbacks carry the current lease token so a late callback cannot mutate a later attempt.
8. Cross-shot frame continuity references a versioned frame asset derived from an approved take's exact video output.
9. Each generated video asset has exactly one `producer_job_id`; a job cannot reuse one of its inputs as its output.
10. Job state writes take an immediate SQLite transaction so independent API and worker connections do not expose raw write-upgrade races.
11. A production Mode describes narrative duties, required artifacts, and gates. It never owns provider commands, model aliases, or task polling.
12. A semantic reference requirement describes what must appear or speak; an immutable job binding describes the exact approved asset and upload order used to satisfy it.
13. Candidate and archived assets cannot enter a job. Submission snapshots the approved current-asset manifest so later replacements do not rewrite generation history.
14. Each planned generation unit is self-contained and records its opening and ending state; it never relies on instructions such as “continue the previous shot”.
15. Batch generation requires an explicitly approved representative result. Provider success alone is not creative or QC approval.
16. A worker with no persisted provider task submits once, stores the returned task id, and polls that same task across lease recovery. A remote URL is not an asset until the output is downloaded, verified, hashed, registered, and linked to a pending take.
17. Worker completion exposes the candidate asset, completed job, and pending take in one immediate SQLite transaction; a filesystem write is staged with a temporary file and compensated if the database transaction fails.

## Production-policy boundary

`director` contributes an extensible Mode concept, versioned identity assets, project-level locks, per-unit start/end state, a recognizable-element matrix, and representative-sample gating. These are domain policies that H3Storyboard will express as validated data and UI gates.

Provider-specific facts remain below that boundary. Model names, current schemas, resolution limits, media counts, authentication, submission, polling, and download behavior belong to `h3-provider` adapters. The core must not hard-code `director`'s current Seedance 2.0 Pro, 720p, 15-second, or shot-count choices.

`director` calls a generated multi-shot clip a segment, while H3Storyboard M0 uses `ShotPlan` as its generation target. Protocol 1.1 must preserve an unambiguous mapping: individual camera shots remain storyboard records; any future multi-shot generation segment groups them explicitly instead of silently changing `ShotPlan` semantics.

## Protocol 1.1 module ownership

```text
packages/protocol
  schemas + snake_case HTTP contract + exported production error codes
packages/project-store
  ProjectStore lifecycle facade
    +-- ModeStore         global policy registry
    +-- ProductionStore   briefs, locks, dry-run compilation
    +-- CharacterStore    character identity and reference lineage
    +-- TakeStore         representative selection/review
  domain operations       assets/manifests, shots, jobs, migrations
packages/h3-provider
  pure binding compiler + exact submitted-input audit
packages/task-engine
  lease state machine + interface-driven H3 worker orchestration
apps/api
  small domain route dispatchers + optional H3_WORKER=1 runtime assembly
apps/studio
  director UI consuming only Protocol 1.1 API shapes
```

Database writes and invariant checks live in project-store transactions. The API parses protocol input and maps stable errors to HTTP status; it does not infer modes, resolve characters, or mutate related rows itself. The binding compiler is deliberately pure: project-store assembles an immutable brief/manifest/character snapshot, the compiler returns ordered inputs, and job creation persists that result without consulting mutable state afterward.

Migrations v7–v14 are additive. V13 repairs pre-semantic image shots by translating legacy image binding roles to semantic purposes. It deliberately does not invent video/audio purposes: v2v/rv2v keep their validated legacy binding path until M3 defines those semantics. V14 adds the nullable job cancellation reason; the existing `provider_job_id` and `output_asset_id` already satisfy worker persistence and output lineage, so they are not duplicated.

## Initial deployment

M0 runs as a local web application on Node 22. The API binds to `127.0.0.1` only and stores data under the user's home directory by default; `H3_STORYBOARD_DB` accepts an explicit path. Desktop packaging is deferred until the workflow and storage contract are stable.
