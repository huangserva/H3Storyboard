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

M1A passed the required architecture, bug, test, and protocol reviews. Follow-up commit `70d83c7` closes findings F1–F10, adds migration v13 compatibility repair, and publishes Protocol 1.1.

## M1B — single-shot H3 loop

- [x] Contract-level TypeScript ComfyUI client, deterministic H3 I2V graph, preflight lint, and read-only node capability evidence (`e0c4f1c`).
- [x] Explicit image, first-frame, and last-frame binding slots.
- [x] `i2v`, `fl2v`, and `r2v` provider validation, including real H.264 + AAC smoke outputs.
- [x] Attach real-generation evidence to candidate modes; promotion to `validated` remains an explicit director decision after visual review.
- [x] Provider worker for submit-once, poll-same-task, cancel audit, restart recovery, and explicit rerun as a new job (`dbc2559`; runtime is now default-on and can be disabled explicitly).
- [x] Download, non-empty verification, content hash, canonical candidate asset registration, and pending-take creation before atomic job completion.
- [x] Actual result capture and QC verdict contract/API.

M1B passed architecture, protocol, and test review; remediation commit `4055bc0`
closes bug findings W1–W10 with migration v15 submit intent, crash recovery,
lease heartbeat/cancel behavior, attempt-owned output paths, and graph-derived
capability inventory. A post-fix real i2v run completed end to end on 2026-08-12.

## M2 — infinite canvas Studio

- [x] P1 React Flow product canvas with Script → Scene → Shot → Job → Asset → Take/QC projection and H3-native-or-silent audio invariant.
- [x] P1.1 idempotent canvas batch bootstrap and project-level generation preflight; 100 Shot startup remains two requests per tab.
- [x] P1.2 test-ready real-media canvas: approved character references, exact Job/Asset/Take lineage, lightboxes, Take/QC/representative controls, repeat focus, and an isolated worker-off demo.
- [x] P1.3 default Production Board with dense character cards, scene asset strips,
  three-column Plan/Latest-Take wall, project character catalog loading, durable
  character image upload/approval/lineage, and a split graph builder.
- [x] P1.3B durable CharacterImageJob execution with real Krea master,
  Qwen identity edit, Krea i2i, shared 8188/8190 GPU coordination,
  candidate-only completion, recovery/cancel/single-retry, bounded backoff,
  compiled-runtime integration, and production-board controls.
- [x] P1.4 immersive canvas focus mode, inspector/asset drawers, real browser
  fullscreen, enlarged media cards, active-scene camera focus, and compact-window
  controls.
- [x] P1.5A scene director projection with scene isolation/navigation, per-scene
  viewport restoration, reference → Plan → H3 Actual/QC lanes, and separate
  first-frame / last-frame / latest-Take media slots on every Plan card.

P1.3B passed the final architecture, bug, test, and protocol reviews at
B+ / B- / B- / B. The final gate passed 225 Vitest assertions plus 14 browser
tests; the single skipped test is the explicit opt-in live ComfyUI probe.

## M3 — multimodal H3

- [ ] `v2v` and `rv2v`.
- [ ] Video and audio reference slots.
- [ ] Prompt-to-upload binding audit.
- [ ] Batch queue and per-shot retry.
