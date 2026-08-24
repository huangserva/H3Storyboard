# Protocol 1.7

`packages/protocol` is the single JSON contract shared by Studio, API, SQLite mappers, task engine, and provider adapters. HTTP fields are `snake_case`. Protocol 1.7 keeps the Protocol 1.6 character catalog and H3-only final-audio policy, and adds durable character-image generation jobs plus a shared GPU-host lease.

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

The array is the upload order and the prompt-reference order. Ordinals must be contiguous from zero. The historical asset model can still describe audio files, but H3 job input rejects every audio binding. Reference limits are 9 images, 3 videos, and 12 mixed image/video files total.

| mode | minimum valid reference contract |
|---|---|
| `t2v` | no reference assets |
| `i2v` | exactly one `first_frame` image |
| `fl2v` | exactly one `first_frame` and one `last_frame` image |
| `r2v` | 1–9 images and no video |
| `v2v` | 1–3 videos and no image |
| `rv2v` | at least one image and one video |

New shot plans and every job reject external audio bindings. Every job persists `audio_mode = h3_native | silent`. `h3_native` preserves only audio produced inside the original H3 output; `silent` disables H3 audio generation. Worker configuration cannot override that immutable decision. TTS, dubbing, voice cloning, music, ambience, rain, room tone, Foley, SFX, and synthetic noise are forbidden. Provider adapters may advertise a narrower capability set but may not weaken this contract.

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
- `provider_client_id` is a durable submit intent written before provider I/O. If the process exits after ComfyUI accepts the prompt but before `provider_job_id` is stored, recovery searches queue and history by this client id and claims the existing prompt.
- `provider_job_id` is the durable ComfyUI prompt id. Reclaiming `timed_out` work verifies and polls that same task. Only after repeated history misses and an absent queue entry may recovery clear both provider ids and resubmit.
- Cancel records a non-empty `cancel_reason`; a rerun is a new job/idempotency key and never reuses the provider task.
- Poll attempts renew the lease. The maximum frame-scaled poll window must be shorter than the lease; a poll timeout interrupts/removes the exact provider task and records recoverable `timed_out`, not permanent failure.
- A worker output becomes visible atomically as a candidate video `Asset` with a real `sha256:<64 hex>` hash, the completed job output, and a pending `ShotActual`. Any database failure rolls back all three.

The local API starts its lease worker by default; `H3_WORKER=0` disables it when a separately managed process owns execution. Before a new submission the worker requires an empty ComfyUI running and pending queue. An occupied external queue becomes recoverable `H3_COMFY_QUEUE_BUSY` without `/free`, upload, or prompt submission. After the queue is free it stores `provider_client_id`, calls `/free`, uploads each binding under a job-and-slot-qualified name, submits, then stores `provider_job_id`. Poll and download are abortable; cancel interrupts a running prompt or removes that exact pending prompt. Output paths carry attempt and lease ownership, so late workers can compensate only its own file. Download, non-empty validation, file persistence, hash, canonical asset registration, pending take, and job completion form the completion gate.

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

`CharacterReference` stores `character_id`, nullable `asset_id`, compatible `uri`, media `kind`, nullable `content_hash`, nullable self-reference `derived_from`, `sort_order`, and timestamps. Derived references must remain in the same project and character lineage and can never occupy root slot `sort_order=0`. Archived characters are immutable. During binding compilation, a character target resolves to the first root mother-image reference by `sort_order` whose linked image asset is both approved and present in the frozen manifest; a derived angle is never promoted as fallback identity.

Routes: `GET|POST|PATCH /api/projects/:project_id/characters`, `GET /api/projects/:project_id/character_catalog`, `GET|POST|PATCH /api/projects/:project_id/characters/:character_id/references`, raw-image `POST /api/projects/:project_id/characters/:character_id/reference_uploads`, and transactional `POST /api/projects/:project_id/characters/:character_id/references/:reference_id/approve`.

Protocol 1.6 adds the project-scoped character catalog, persistent uploaded reference assets, idempotent upload receipts, explicit candidate approval, and asset-level multi-angle derivation lineage. A derived upload is accepted only when its source is an approved image-backed reference in the same character.
Uploaded reference content and lineage are immutable after registration; only display ordering may change. Root mother images may be promoted with `make_primary=true`; derived angle images are approved with `make_primary=false` so subsequent angles continue to derive from the canonical root rather than from another angle.

## Character image jobs and shared GPU lease

`CharacterImageJob` is separate from video-only `H3Job`. Its immutable operation is
`master_t2i | identity_edit | variant_i2i`; the engine is respectively Krea2,
Qwen Image Edit 2511, or Krea2. Master generation has no source and a null
`denoise`; identity edit freezes 1–3 approved image references and variant i2i
freezes exactly one approved root mother image, both with an explicit `denoise`.
Each frozen source stores `reference_id`, `asset_id`, and a real SHA-256 hash.

The lifecycle and submit-intent recovery discipline match H3 jobs. Completion is
one SQLite transaction that creates a candidate image Asset, a CharacterReference,
optional character asset derivation, and both output ids before marking the job
completed. The Asset records `producer_image_job_id`; generated content and lineage
are immutable. Failed, canceled, and timed-out jobs may create an immutable retry
with a new idempotency key and `retry_of_job_id`; the original record is unchanged.
At most one retry row may reference an original job, enforced by migration v21,
so concurrent clicks cannot fan one failure into multiple 4090 submissions.

The image worker persists a provider client id before `/prompt`, recovers the same
task by client id or prompt id, and never resubmits while that task still exists.
Queue-busy, insufficient-VRAM, missing-task, and timeout outcomes are recoverable
`timed_out` states. Automatic claims use bounded exponential backoff and stop after
eight attempts; the Studio continues polling while automatic recovery is eligible.
Cancel removes or interrupts only the recorded provider prompt. Completion always
creates a candidate reference: only a separate director approval can make it the
canonical root or an approved derived angle.

H3 video jobs use the same bounded eight-attempt exponential auto-recovery rule.
Fresh drafts remain eligible while an older timed-out job is cooling down, so a
busy shared GPU cannot make the oldest H3 job starve the rest of the queue.

If the API is intentionally separated from the provider-owning worker, it must be
given an explicit cancellation callback. Without that owner channel, canceling a
submitted task fails with `CHARACTER_IMAGE_CANCEL_UNAVAILABLE` and leaves durable
state unchanged; the API never reports a local cancellation while 4090 work runs.

`GpuLease` provides one owner per `gpu_host` across H3 video and character-image
workers. It freezes `owner_kind`, `owner_job_id`, a unique lease token, expiry, and
heartbeat. Acquire, renew, release, and expired-row recovery are immediate SQLite
transactions. A project generation lock cannot engage across active image work,
and image work cannot be claimed while the project lock is engaged. Before a new
submission, both configured ComfyUI queues are checked, capability discovery runs,
and both queues are checked again. `/free` is sent only to endpoints explicitly
listed in `H3_MANAGED_COMFY_ENDPOINTS`; there is no implicit managed endpoint.

Routes: `POST /api/projects/:project_id/characters/:character_id/image_jobs`,
`GET /api/projects/:project_id/character_image_jobs`, and scoped `retry` / `cancel`
POST routes under `/api/projects/:project_id/character_image_jobs/:job_id`.

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

## Canvas bootstrap and generation preflight batches

`PUT /api/projects/:project_id/canvas_nodes` accepts unique
`(node_type, ref_id)` entries within the API's 1 MB JSON body limit. The store validates every project-owned reference
before writing, then performs the batch in one immediate SQLite transaction.
Missing nodes are inserted; existing nodes are preserved by default, making two
tabs safe to load concurrently. `update_position_if_untouched = true` may update
only the x/y of an otherwise untouched row (the Studio uses this for one-time
localStorage migration). `update_layout_if_untouched = true` may instead update
x/y, size and z-index together for a one-time product layout migration. Neither
flag can overwrite a previously modified row. The response returns the complete
project canvas plus `created_count` and `updated_count`. A validation or
reference failure rolls back the whole batch.

`GET /api/projects/:project_id/jobs/preflights` returns `{project_id, items}` in
shot ordinal order. Each item contains `shot_plan_id` and the existing
`GenerationPreflight` shape. A shot-level production `StoreError` remains that
shot's stable `blocking_error`; an unexpected server failure still fails the
whole request. The single-shot preflight route remains compatible.

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
| `GET` | `/api/assets/:asset_id/file` | stream the on-disk asset; supports a single byte `Range` with `206` |
| `GET/POST` | `/api/projects/:project_id/canvas_nodes` | list or create persisted canvas nodes |
| `PUT` | `/api/projects/:project_id/canvas_nodes` | atomically ensure nodes and return the complete canvas |
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
| `GET` | `/api/projects/:project_id/shots/:shot_plan_id/jobs/preflight` | read one shot generation preflight |
| `GET` | `/api/projects/:project_id/jobs/preflights` | read all project shot preflights in one ordered response |
| `POST` | `/api/shots/:shot_plan_id/actuals` | append a pending generated take |
| `POST` | `/api/actuals/:actual_id/review` | approve or reject a pending take once |
| `POST` | `/api/actuals/:actual_id/representative` | select or withdraw representative |
| `POST` | `/api/actuals/:actual_id/representative/review` | approve or reject representative |

The API binds to `127.0.0.1`. JSON bodies are limited to 1 MB. Asset paths are relative and reject absolute paths plus `.` or `..` traversal segments. Media reads resolve the stored path again beneath the configured data directory before opening a file; missing metadata, missing files, invalid paths, and invalid ranges use stable `ASSET_*` codes.

Production-policy errors are stable codes exported by `packages/protocol`: `BINDING_INVALID_COMBINATION`, `BINDING_KIND_MISMATCH`, and `MODE_BLOCKED`. Other stable families include `CHARACTER_*`, `ASSET_*`, `MANIFEST_*`, `MODE_*`, `BRIEF_*`, `LOCK_*`, `BINDING_*`, `TAKE_*`, `H3_*`, and `QC_VERDICT_INVALID`; clients must branch on `code`, never message text.
