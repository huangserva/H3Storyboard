# Delivery plan

## M0 — durable director foundation

- [x] Independent repository and architecture decision.
- [x] Protocol schemas for projects, assets, planned shots, actual shots, and H3 jobs.
- [x] SQLite migrations v1–v5 and durable CRUD/lifecycle.
- [x] Local API with real HTTP + SQLite and compiled-runtime integration tests.
- [x] Studio shell showing separate planned and actual columns.
- [x] Architecture, bug, test, and protocol reviews all at B- or above (A- / A- / B+ / A).

## M1A — director-ready production contract

- [x] Extensible production Mode registry with `candidate` / `validated` / `blocked` capability status; no hard-coded production-policy enum.
- [x] Versioned production brief, text style lock, project generation locks, and immutable lock snapshot on each job.
- [x] Asset lifecycle (`candidate` / `approved` / `archived`), stable revisions, replacement lineage, and an authoritative current-assets manifest.
- [x] Per-shot semantic reference requirements compiled into exact ordered H3 bindings; reject both missing and unrelated inputs.
- [x] Explicit opening and ending state for character position, appearance state, prop custody/damage, scene state, and sound handoff.
- [x] Representative-take approval gate before any repeated-shot or future batch submission, with an auditable override reason.
- [x] Resolve the camera-shot versus multi-shot generation-segment boundary before Protocol 1.1 migration (ADR: one `ShotPlan` is one generation segment).

## M1B — single-shot H3 loop

- [ ] Explicit image, first-frame, and last-frame binding slots.
- [ ] `i2v`, `fl2v`, and `r2v` provider validation.
- [ ] Local ComfyUI adapter with live capability discovery and `candidate` / `verified` / `blocked` evidence.
- [ ] Provider worker for submit-once, poll-same-task, cancel, restart recovery, and explicit rerun (store lifecycle is complete).
- [ ] Download, non-empty verification, content hash, canonical asset registration, and pending-take creation before job completion.
- [x] Actual result capture and QC verdict contract/API.

## M2 — multimodal H3

- [ ] `v2v` and `rv2v`.
- [ ] Video and audio reference slots.
- [ ] Prompt-to-upload binding audit.
- [ ] Batch queue and per-shot retry.
