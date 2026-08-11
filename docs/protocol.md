# Protocol 1.0

`packages/protocol` is the single JSON contract shared by Studio, API, SQLite mappers, task engine, and provider adapters. HTTP fields are `snake_case`.

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

M0 persists creation, claim, queued, running, completion, fail, cancel, heartbeat, and expired-lease recovery. Opening the store automatically moves expired active leases to `timed_out`; the worker may also invoke recovery while it runs. A real provider worker that invokes those operations is M1 work.

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
| `POST` | `/api/shots/:shot_plan_id/jobs` | idempotently create a validated draft job |
| `POST` | `/api/shots/:shot_plan_id/actuals` | append a pending generated take |
| `POST` | `/api/actuals/:actual_id/review` | approve or reject a pending take once |

The API binds to `127.0.0.1`. JSON bodies are limited to 1 MB. Asset paths are relative and reject absolute paths plus `.` or `..` traversal segments.
