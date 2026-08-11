# M0 Self-Review

- Date: 2026-08-11
- Scope: independent repository, protocol, SQLite project store, local API, Studio shell, durable H3 task lifecycle, continuity lineage, actual/QC records.
- Gate: `pnpm check && pnpm build && pnpm test` passed; 6 test files and 32 tests passed.

## Independent review summary

| Angle | Earlier score | Final score | Final verdict |
|---|---:|---:|---|
| A — architecture and maintainability | C+ | A- | No remaining M0 issue. Runtime exports, continuity migrations, producer lineage, immediate job writes, server lifecycle, recovery, and stable data path were verified. |
| B — real bugs and boundaries | B- | A- | All reported consistency, socket, lease, event order, output lineage, and latest-take QC bugs were fixed. The final low lease-range issue was also fixed after review. |
| C — test quality | C- / C+ | B+ | No fake tests or production-code test infection. Real HTTP + SQLite, compiled runtime, migration, restart, two-connection outcomes, QC errors, H3 limits, and lease errors are covered. |
| D — protocol alignment | B | A | No remaining issue. Audio, pending-only take creation, plan/job bindings, legacy-job audit, and unique output lineage match Protocol 1.0. |

## Serious-item verdicts

| Finding | Verdict | Evidence |
|---|---|---|
| Package exports pointed at TypeScript sources and compiled API startup failed. | Fixed | Package exports point at `dist`; `tests/integration/production-start.test.ts` starts `node apps/api/dist/main.js`. |
| Planned continuity could be omitted from an H3 job or downgraded to `t2v`. | Fixed | `store-guards.ts` compares plan and job bindings; the real HTTP test rejects missing continuity with `H3_BINDINGS_INVALID`. |
| Legacy continuity migration changed field names without preserving video semantics or auditing historical jobs. | Fixed | Migration v4 maps valid v2 data to `full_video + motion`, audits every historical job, and refuses to rewrite immutable invalid inputs. The real SQLite fixture proves fail-then-valid migration. |
| Active work was not automatically recovered and stale/expired callbacks could mutate newer attempts. | Fixed | Store startup recovers expired leases; lease tokens, bounded renewal, ordered events, exact-once recovery, and stale/expired callbacks are covered in `job-recovery.test.ts`. |
| Planned and actual records could drift, be pre-approved, or be reviewed twice. | Fixed | Actual creation is pending-only, append-only, tied to the exact completed job/output, and review is one-shot. HTTP tests cover wrong output, wrong shot, unfinished job, conflict, pre-approval, and double review. |
| Output assets did not prove a unique producer job and could reuse an input. | Fixed | Migration v5 adds `producer_job_id` plus two unique indexes; runtime completion claims both sides in one immediate transaction and rejects self-output. |
| `start()` racing `close()` could leave a live socket with a closed store. | Fixed | Server close joins the pending start and is idempotent; integration rebinds the same port after the race. |

## Accepted low risks

- The compiled-entry test probes health rather than repeating the full write/restart scenario. Accepted because the full behavior already crosses real HTTP + SQLite in `api.test.ts`, while the compiled test independently proves production module resolution and process shutdown.
- Generic HTTP hardening cases such as payloads over 1 MB, empty/malformed JSON, and malformed routes do not yet have dedicated tests. Accepted for M0 because they are outside the frozen director workflow; `readJson` and route errors still return stable envelopes. Risk is limited to error-path regression, not project data semantics.

## Scope and change accounting

- Existing application code or tests deleted: none; this is a new repository.
- External source copied: none. The compared repositories informed product and workflow decisions only.
- Explicitly outside M0: real ComfyUI/MiniMax submit-poll-cancel worker, binary asset upload, desktop packaging, and end-to-end H3 generation.

## Overall

Overall grade: **A-**. The M0 foundation is complete and internally consistent. It is ready for M1 provider integration without claiming that real H3 generation is already connected.
