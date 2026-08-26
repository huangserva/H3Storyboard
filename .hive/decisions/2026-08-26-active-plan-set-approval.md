# Decision: explicit active plan-set approval

Date: 2026-08-26  
Status: accepted for P2.2

## Context

P2.1 can lock a successor ScriptVersion and compile provenance-linked draft
ShotPlans. Production must keep using the prior approved Plans until a director
accepts the complete successor set. Switching on script lock would interrupt
work too early; approving Plans independently would expose mixed-version
execution state.

## Decision

- `projects.active_script_version_id` names the current locked authoring source.
- nullable `projects.active_script_compilation_id` separately names the current
  approved execution plan-set.
- `ScriptCompilation` and its Plans move together through
  `draft -> approved -> superseded`.
- Director edits use compilation and Plan optimistic revisions. `sound`, source
  provenance, binding, continuity, and production fields are outside the edit
  contract.
- Approval is one immediate SQLite transaction: validate the complete source
  set, supersede prior approved compilation/Plans, approve the successor, then
  switch the project pointer.
- Historical Job/Take/Asset rows and Plan content remain immutable. Existing
  Job requests replay by idempotency key, while new Jobs or retries on a
  superseded Plan are rejected.

## Consequences

The active authoring script may be newer than the active production plan-set;
the UI and protocol must show both identities. P2.3 AI writing can create only
draft script/plan state and cannot bypass validate, lock, review, or approval.
Future per-scene partial adoption would require a new explicit protocol; it
must not weaken this all-or-nothing plan-set boundary implicitly.
