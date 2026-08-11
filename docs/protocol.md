# Protocol 1.2

`packages/protocol` is the single JSON contract shared by Studio, API, SQLite mappers, task engine, and provider adapters. HTTP fields are `snake_case`. Protocol 1.2 retains the M0 planned/actual and M1A production invariants and adds the M1B lease-worker audit fields below.

## Project lineage

```text
Project
  └─ locked ScriptVersion
       └─ ShotPlan (director intent)
            ├─ H3Job (immutable generation input + lifecycle)
            │    └─ Asset (generated video)
            └─ ShotActual / Take (observed result + QC verdict)
```

- Creating a project atomically creates and locks script version 1.
- Plans and takes are different records. A take never mutates its plan.
- Reruns append takes with increasing `attempt_number`.
- A take is pending until a separate QC decision approves or rejects it.
- Continuity dependencies point to an approved source take. Frame continuity uses an image explicitly derived from that take's video; full-video continuity references the video itself.
- Every continuity dependency must also appear in the plan binding list and in each submitted H3 job with the same kind, role, and ordinal. A continued shot cannot silently fall back to `t2v`.
- Migration v4 preserves legacy video continuity as `full_video + motion`. If a historical job omitted that upload, migration stops with `DATABASE_RECORD_INVALID` rather than rewriting immutable generation history.

## H3 input binding

Every uploaded reference has one ordered `AssetBinding`:

```json
{
  "asset_id": "uuid",
  "asset_kind": "image | video | audio",
  "role": "first_frame | last_frame | character | product | scene | style | motion | audio",
  "ordinal": 0
}
```

The array is the upload order and the prompt-reference order. Ordinals must be contiguous from zero. Limits are 9 images, 3 videos, 3 audio files, and 12 mixed files total.

| mode | minimum valid reference contract |
|---|---|
| `t2v` | no reference assets |
| `i2v` | exactly one `first_frame` image |
| `fl2v` | exactly one `first_frame` and one `last_frame` image |
| `r2v` | 1–9 images and no video |
| `v2v` | 1–3 videos and no image |
| `rv2v` | at least one image and one video |

Audio may accompany the reference modes within H3 limits; it cannot be the only input. Provider adapters may advertise a narrower capability set but may not weaken this contract.

Assets store project-relative paths and content hashes. A generated video records its unique `producer_job_id`; one output asset cannot be claimed by two jobs. A derived boundary frame additionally stores `derived_from_asset_id` plus `derivation_kind = first_frame | last_frame | frame_extract`; the store verifies that its source is a video in the same project.

## Job lifecycle

```text
draft -> submitting -> queued -> running -> completed
          |             |         |\-> failed -> submitting
          |             |         \-> timed_out -> submitting
          +-------------+-----------> canceled (terminal)
```

- `completed` and `canceled` are terminal.
- Claiming work increments `attempt` and stores a lease before provider submission.
- Every claim creates a new `lease_token`; provider callbacks carrying an older token are rejected.
- `(shot_plan_id, idempotency_key)` is unique.
- Replaying the same key with the same input returns the original job.
- Replaying it with different input returns `IDEMPOTENCY_KEY_REUSED`.
- Every transition appends a `job_event` in the same database transaction.
- Heartbeats renew active leases. On restart, expired active leases move once to `timed_out` and can be explicitly reclaimed.
- `provider_job_id` is the durable ComfyUI task id. Reclaiming `timed_out` work preserves it and polls that same task; only a job without one may submit.
- Cancel records a non-empty `cancel_reason`; a rerun is a new job/idempotency key and never reuses the provider task.
- A worker output becomes visible atomically as a candidate video `Asset` with a real `sha256:<64 hex>` hash, the completed job output, and a pending `ShotActual`. Any database failure rolls back all three.

The optional local worker is disabled unless `H3_WORKER=1`. Before a new submission it may call `/free` (default enabled), uploads the compiled first frame, persists the returned prompt id, and only then polls. Download, non-empty validation, file persistence, hash, canonical asset registration, pending take, and job completion form the completion gate. Protocol 1.2 does not claim real-provider validation; M1B-3 supplies that evidence.

Worker failures persist stable `H3_WORKER_*` or `H3_COMFY_*` codes. Input mode/seed/binding/file failures are distinct from provider HTTP/protocol/timeout/output failures; clients must not infer them from messages.

## Character identity

`Character` is project-scoped and append-only by default:

| field | contract |
|---|---|
| `id`, `project_id` | UUID identity and owner |
| `name` | non-empty display name |
| `canonical_appearance` | non-empty canonical English prompt text |
| `seed_family` | ordered non-negative integer seeds |
| `status` | `candidate | approved | archived` |
| `created_at`, `updated_at` | ISO timestamps |

`CharacterReference` stores `character_id`, nullable `asset_id`, compatible `uri`, media `kind`, nullable `content_hash`, nullable self-reference `derived_from`, `sort_order`, and timestamps. Derived references must remain in the same project and character lineage. Archived characters are immutable. During binding compilation, a character target resolves to the first reference by `sort_order` whose linked asset is both approved and present in the frozen manifest.

Routes: `GET|POST|PATCH /api/projects/:project_id/characters` and `GET|POST|PATCH /api/projects/:project_id/characters/:character_id/references`.

## Asset lifecycle and current-assets manifest

`Asset` contains `id`, `project_id`, `kind (image|video|audio)`, project-relative `uri` and `relative_path`, nullable `content_hash`, `status`, nullable `replaces_asset_id`, derivation/output lineage, and timestamps.

```text
candidate -> approved -> archived
    \--------------------> archived
```

- Archived is terminal. Approved content is immutable.
- A candidate replacement leaves the approved predecessor active. Approving the replacement atomically archives its predecessor.
- URI fallback into `relative_path` applies the same traversal rejection as an explicit path: absolute paths and `.`/`..` segments are invalid.
- A `CurrentAssetsManifest` is an immutable project snapshot with monotonically increasing `manifest_version`; `ManifestEntry` contains only `manifest_id + asset_id`.
- Freeze includes all and only currently approved project assets. Later approval or archival never rewrites an old manifest.

Routes: `GET|POST|PATCH /api/projects/:project_id/assets`; `GET|POST /api/projects/:project_id/manifests`; `GET /api/projects/:project_id/manifests/:manifest_version`.

## Production Mode registry

`Mode` is global and keyed by unique kebab-case `key`. It stores `title`, `description`, extensible `capability_declaration`, `validation_status`, nullable evidence, and timestamps. The declaration validates generation modes, duration and resolution ranges, LoRA/profile requirements, provider requirements, and JSON extensions.

```text
candidate --evidence--> validated --evidence--> blocked --> candidate
```

Transitions cannot skip. `blocked` modes cannot create briefs, compile bindings, or create jobs. Candidate remains executable in M1A; M1B may tighten execution to validated after provider evidence exists. Capability changes are rejected while any project generation lock is engaged.

Routes: `GET|POST|PATCH /api/modes`.

## Production brief, lock, and immutable job snapshot

`ProductionBrief` is immutable and project-versioned: `id`, `project_id`, monotonic `brief_version`, `mode_key`, `body`, `created_at`. Body contains `logline`, `style_notes`, nullable `text_style_lock`, and ordered `hard_rules`.

`ProjectGenerationLock` contains `project_id`, `engaged`, timestamps, and nullable reason. While engaged, brief creation, manifest freeze, asset lifecycle changes, shot semantic/state updates, character-reference changes, and global Mode capability changes are rejected with `LOCK_ENGAGED`.

Job creation requires a brief, manifest, and engaged lock. Missing legacy context returns `LOCK_REQUIRED`, `BRIEF_REQUIRED`, or `MANIFEST_REQUIRED` with a human-readable list and `missing_steps` detail covering every required setup action. Each job freezes `{brief_version, manifest_version, mode_key, locked_at}` as `lock_snapshot`; it never follows later context versions.

Routes: `GET|POST /api/projects/:project_id/briefs`; `GET|PUT /api/projects/:project_id/generation_lock`.

## Semantic references, shot state, and compiled bindings

`ShotPlan.semantic_references` is ordered and uses purposes:

`first_frame | last_frame | reference_character | reference_prop | reference_composition | reference_style | reference_stage | reference_target_state`.

Each target is exactly one of `{type:"character", character_id}` or `{type:"asset", asset_id}`. All semantic purposes currently compile to image assets. `opening_state` and `ending_state` are nullable while drafting; a filled state includes character position/appearance, prop custody/damage, `scene_state`, and `sound_handoff`.

The pure compiler returns `{generation_mode, bindings[]}` where every `CompiledBinding` freezes `slot_index`, `purpose`, `asset_id`, and `uri`. Order is `first_frame`, then ending frame, then other references in declaration order.

- no references -> `t2v`; only `first_frame` -> `i2v`; `first_frame` plus exactly one `last_frame` or `reference_target_state` -> `fl2v`; other image references -> `r2v`.
- An ending input without `first_frame`, duplicate/ambiguous endings, or mixing interpolation endings with general references returns `BINDING_INVALID_COMBINATION`.
- Missing/unapproved/non-manifest inputs return `BINDING_MISSING_INPUT`; non-image semantic assets return `BINDING_KIND_MISMATCH`; unsupported Mode capability returns `MODE_CAPABILITY_MISMATCH`.
- Submitted i2v/fl2v/r2v assets must equal the compiled list in asset, role, and ordinal: omissions return `BINDING_MISSING_INPUT`, extras/reordering return `BINDING_UNRELATED_INPUT`.
- v2v/rv2v remain on the original validated `AssetBinding` path until M3 defines video semantic purposes; their jobs store `compiled_bindings = null`.
- Migration v13 backfills legacy image `reference_bindings` into equivalent semantic references. Video/audio bindings remain on the original path because Protocol 1.1 has no truthful video/audio semantic purpose.

Routes: `PATCH /api/shots/:shot_plan_id`; `POST /api/shots/:shot_plan_id/compile_bindings`.

## Representative-take gate

`ShotActual` keeps QC fields and independently adds `is_representative`, `representative_status (none|pending|approved|rejected)`, and nullable representative `approved_at`. Selecting a representative sets pending; review approves or rejects exactly once; transfer requires explicitly withdrawing the current representative first. A partial unique database index enforces one representative per shot.

The first job for a shot is ungated. Every later job requires an approved representative or a non-empty `gate_override_reason`, which is persisted on the immutable job input and participates in its idempotency fingerprint. Representative approval never mutates `qc_verdict`, and QC approval never opens this gate.

Routes: `POST /api/actuals/:actual_id/representative`; `POST /api/actuals/:actual_id/representative/review`.

## Local HTTP API

Success envelope:

```json
{ "data": {} }
```

Error envelope:

```json
{
  "error": {
    "code": "STABLE_MACHINE_CODE",
    "message": "Human-readable summary",
    "details": {}
  }
}
```

| method | path | behavior |
|---|---|---|
| `GET` | `/api/health` | health and `protocol_version` |
| `GET` | `/api/projects` | project summaries |
| `POST` | `/api/projects` | project + locked full script v1 |
| `GET` | `/api/projects/:project_id` | durable project snapshot |
| `POST` | `/api/projects/:project_id/shots` | append a plan |
| `POST` | `/api/projects/:project_id/assets` | register project-relative asset metadata |
| `GET/PATCH` | `/api/projects/:project_id/assets` | list or update asset lifecycle metadata |
| `GET/POST` | `/api/projects/:project_id/canvas_nodes` | list or create persisted canvas nodes |
| `PATCH` | `/api/projects/:project_id/canvas_nodes` | update canvas position, size, or z-index |
| `GET/POST/PATCH` | `/api/projects/:project_id/characters` | character CRUD/archival |
| `GET/POST/PATCH` | `/api/projects/:project_id/characters/:character_id/references` | reference lineage |
| `GET/POST` | `/api/projects/:project_id/manifests` | list or freeze manifests |
| `GET` | `/api/projects/:project_id/manifests/:manifest_version` | immutable manifest version |
| `GET/POST/PATCH` | `/api/modes` | global Mode registry |
| `GET/POST` | `/api/projects/:project_id/briefs` | list or append briefs |
| `GET/PUT` | `/api/projects/:project_id/generation_lock` | read or engage/release lock |
| `PATCH` | `/api/shots/:shot_plan_id` | update semantic references and shot states |
| `POST` | `/api/shots/:shot_plan_id/compile_bindings` | dry-run deterministic compilation |
| `POST` | `/api/shots/:shot_plan_id/jobs` | idempotently create a validated draft job |
| `POST` | `/api/shots/:shot_plan_id/actuals` | append a pending generated take |
| `POST` | `/api/actuals/:actual_id/review` | approve or reject a pending take once |
| `POST` | `/api/actuals/:actual_id/representative` | select or withdraw representative |
| `POST` | `/api/actuals/:actual_id/representative/review` | approve or reject representative |

The API binds to `127.0.0.1`. JSON bodies are limited to 1 MB. Asset paths are relative and reject absolute paths plus `.` or `..` traversal segments.

Production-policy errors are stable codes exported by `packages/protocol`: `BINDING_INVALID_COMBINATION`, `BINDING_KIND_MISMATCH`, and `MODE_BLOCKED`. Other stable families include `CHARACTER_*`, `ASSET_*`, `MANIFEST_*`, `MODE_*`, `BRIEF_*`, `LOCK_*`, `BINDING_*`, `TAKE_*`, `H3_*`, and `QC_VERDICT_INVALID`; clients must branch on `code`, never message text.
