# M1B worker reliability remediation index

Date: 2026-08-12 (Asia/Shanghai)

## Scope and decision

This note indexes the implementation evidence for the four-way M1B review in
`docs/reviews/m1b-bug-review.md`. The central decision is a two-identity submit
protocol: persist a unique ComfyUI `client_id` before provider I/O, then persist
the returned prompt id. Recovery claims queue/history work by either identity;
only repeated history misses plus an absent queue entry permit resubmission.

## Findings closed

- W1: output paths now include job, attempt, and lease token. Compensation
  removes only the current worker's owned file. A two-worker lease-expiry test
  proves the newer completed output survives the stale worker.
- W2/W4: migration v15 adds nullable `provider_client_id`; submit intent is
  committed before upload/submit. Recovery searches queue/history by client id
  and confirms prompt absence three times before clearing ids and resubmitting.
- W3: frame count scales the polling budget; timeout interrupts/removes the
  exact task and persists recoverable `timed_out` rather than permanent failure.
- W5: uploads use `{job_id}-slot{n}-{basename}`, keeping equal basenames distinct.
- W6: cancel aborts active polling and removes a pending target or interrupts a
  running target without interrupting unrelated ComfyUI work.
- W7: empty exceptions normalize to a stable non-empty failure. A last-resort
  same-lease transaction prevents a secondary persistence error leaving a live job.
- W8/W10: i2v, fl2v, stock r2v, and hybrid r2v share one graph skeleton. Required
  capability nodes are the union derived from representative built graphs; a
  guard test asserts every emitted node is discoverable.
- W9: every poll attempt heartbeats the lease. Startup rejects a maximum
  frame-scaled poll window that is not shorter than the configured lease.

## Verification

`pnpm check && pnpm build && pnpm test` passed after remediation: 11 test files,
92 passed, and the opt-in real capability probe skipped. Modified service files
remain below 300 lines (`h3-worker.ts` 218, support 131, ComfyUI client 293,
ProjectStore facade 294).

Post-fix real i2v regression evidence:

- job `c5685701-e96e-4c93-a0dc-301de9986fa2`, attempt 1
- client id `b595bf21-0e92-411d-b895-04a60290da60`
- prompt id `9786f634-5861-4737-872b-ed03dc89220d`
- submit-to-completed: 70.476 seconds; observed GPU use peak 43,635 MiB
- output: 516,342 bytes, 480×864, 24 fps, 5.167 seconds
- streams: H.264 video + AAC audio
- sha256: `e3a299bc49d5efa7a48dc29a29b1b2fde3164658e7bc3f20741d46f435d5d0fc`
- candidate asset `3bdac642-29d5-4111-bdea-ecd3b9f2db7a`
- pending actual `dd68833c-8345-4cff-abe2-27cfbbc899d9`
- immutable lock snapshot used brief v3 / manifest v4 / cinematic-drama;
  project generation lock was released afterward.

## Residual boundary

If ComfyUI restarts after executing a prompt and clears both queue and history,
the local worker cannot prove that lost remote execution. It performs repeated
absence checks, starts a new audited attempt, and never overwrites a prior
attempt path. Mode validation remains candidate pending director visual review.
