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
5. Every job stores its prompt, mode, model, seed, steps, audio mode, input bindings, and lifecycle events.
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
16. A worker persists a unique provider client id before submission. Recovery first claims a matching ComfyUI queue/history task and only resubmits after repeated proof that neither client intent nor prompt id exists remotely.
17. Worker completion exposes the candidate asset, completed job, and pending take in one immediate SQLite transaction. Files are staged under attempt-and-lease-qualified paths, so a late worker can compensate only its own output.
18. Provider graph builders share one Director/LoRA/sampler/output skeleton. Capability discovery is the union of node classes emitted by representative i2v, fl2v, stock r2v, and hybrid r2v graphs.
19. Final video audio is either the original audio present in the H3 output or silence. External audio assets and post-generation audio layers never enter the render path.
20. Character-image generation has its own durable job and event stream; it never masquerades as an H3 video job or writes directly over an approved reference.
21. H3 video and character-image workers acquire the same durable GPU-host lease and inspect every configured queue before any new submission or explicitly managed memory release.
22. A generated character image becomes a candidate Asset and CharacterReference in one transaction. Director approval, manifest freeze, and H3 binding remain separate later decisions.

## Production-policy boundary

`director` contributes an extensible Mode concept, versioned identity assets, project-level locks, per-unit start/end state, a recognizable-element matrix, and representative-sample gating. These are domain policies that H3Storyboard will express as validated data and UI gates.

Provider-specific facts remain below that boundary. Model names, current schemas, resolution limits, media counts, authentication, submission, polling, and download behavior belong to `h3-provider` adapters. The core must not hard-code `director`'s current Seedance 2.0 Pro, 720p, 15-second, or shot-count choices.

`director` calls a generated multi-shot clip a segment, while H3Storyboard M0 uses `ShotPlan` as its generation target. The protocol preserves an unambiguous mapping: individual camera shots remain storyboard records; any future multi-shot generation segment groups them explicitly instead of silently changing `ShotPlan` semantics.

## Protocol 1.8 module ownership

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
  pure binding compiler + H3/Krea/Qwen graphs + strict ComfyUI transport
packages/task-engine
  shared GPU coordinator + H3/image workers + orphan quarantine
apps/api
  small domain route dispatchers + independently switchable H3/image workers
apps/studio
  director UI consuming only Protocol 1.8 API shapes
```

Database writes and invariant checks live in project-store transactions. The API parses protocol input and maps stable errors to HTTP status; it does not infer modes, resolve characters, or mutate related rows itself. The binding compiler is deliberately pure: project-store assembles an immutable brief/manifest/character snapshot, the compiler returns ordered inputs, and job creation persists that result without consulting mutable state afterward.

## Storyboard canvas projection

The Studio uses React Flow as a read/write projection over protocol truth. Script, scene, reference asset, character, `ShotPlan`, H3 job, generated output asset, and `ShotActual`/QC nodes are derived from each `ProjectSnapshot`; they never create a second business-state store. Generation lineage is rendered as `ShotPlan -> H3Job -> output Asset -> ShotActual`, while continuity points back to the exact source take and boundary-frame asset. Only authored shot and character coordinates use the existing `canvas_nodes` persistence contract. Dragging one of those anchor nodes PATCHes SQLite through a per-node serial queue; failed writes roll back immediately, while derived nodes remain read-only and are deterministically rebuilt after polling or restart. Initial layout is one idempotent batch PUT that preserves existing coordinates, and all per-shot generation preflights are returned by one project-level GET per polling interval. This keeps a 100-shot canvas at a fixed two-request bootstrap budget and makes concurrent tabs converge on the same SQLite rows.

The four-zone desktop layout keeps project navigation, the asset palette, the media graph, and node inspection separate. The graph exposes Script → Scene → Shot → H3 Job → Take/QC, semantic asset/character references, continuity edges, media previews, controls, and a minimap. Provider `completed` and creative `approved` remain visually and structurally distinct.

The P1.2 test-drive fixture uses the same Store transitions as production to
materialize completed jobs and Takes in an isolated SQLite database. Its media
files are copied into the project data tree, hash-addressed through normal Asset
records, and served by the production Range endpoint. Seed-time MP4 inspection
rejects an audio handler or a missing video handler. `pnpm demo:canvas` always
sets `H3_WORKER=0`, so opening the test canvas cannot submit to ComfyUI or wake
the 4090. Demo state is not a fallback in the API or Studio runtime.

Migrations v7–v21 are additive. V13 repairs pre-semantic image shots by translating legacy image binding roles to semantic purposes. It deliberately does not invent video/audio purposes: v2v/rv2v keep their validated legacy binding path until M3 defines those semantics. V14 adds the nullable job cancellation reason. V15 adds nullable `provider_client_id`, the pre-submit intent used to recover ComfyUI prompts accepted inside the former submit/persist crash window; historical jobs remain valid with null. V16 adds immutable `audio_mode`; historical jobs backfill to `h3_native`. V17 adds idempotent character-reference upload receipts, V18 records asset-level character angle derivations, and V19 repairs legacy duplicate/derived primary slots before enforcing one root primary per character. V20 adds durable character-image jobs/events, the shared GPU-host lease, image-output lineage, and retry ancestry. V21 enforces one immutable retry per original image job.

## Initial deployment

M0 runs as a local web application on Node 22. The API binds to `127.0.0.1` only and stores data under the user's home directory by default; `H3_STORYBOARD_DB` accepts an explicit path. Desktop packaging is deferred until the workflow and storage contract are stable.
