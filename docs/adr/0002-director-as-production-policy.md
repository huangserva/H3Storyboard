# ADR 0002: Use director as a production-policy reference

- Status: accepted
- Date: 2026-08-11

## Context

The local `/Users/serva/development/director` repository is an MIT-licensed Agent Skill rather than an application runtime. It separates creative Mode, Mode-specific style/reference assets, and execution Tool. Its Cinematic Drama workflow also formalizes versioned identity assets, a current-assets manifest, opening/ending state, project locks, and representative-segment approval.

H3Storyboard M0 already owns durable project, shot, job, take, QC, and continuity lineage. It does not yet model the production policy that decides which assets and approvals are required before a valid H3 submission.

## Decision

Treat `director` as a design and policy source, not as a package dependency or provider implementation.

1. Production Modes are extensible, versioned definitions with explicit `candidate` or `validated` status.
2. A Mode declares narrative duties, required production artifacts, semantic reference requirements, and quality gates.
3. Semantic requirements compile into immutable, ordered H3 job bindings using only approved assets from a snapshotted current-assets manifest.
4. Generation units record self-contained opening and ending state plus the exact project locks used to compile them.
5. Batch submission remains blocked until a representative result receives explicit approval.
6. Provider adapters alone own model aliases, live capability schemas, authentication, parameters, task tracking, and downloads.

## Consequences

- Protocol 1.1 and its SQLite migration must land before the real provider worker, otherwise the worker would persist an incomplete input contract.
- Asset approval is distinct from take QC: asset approval controls eligibility as an input, while take QC controls whether an output is accepted.
- Current `ShotPlan` semantics cannot silently expand to mean a `director` multi-shot segment. If H3 multi-shot generation is supported, an explicit grouping record must preserve camera-shot granularity.
- `director`'s current Seedance model, 720p resolution, 15-second duration, and shot-count rules remain Mode/provider configuration, not H3Storyboard invariants.
- Cinematic Drama and Visual Journalism remain candidate capabilities until H3Storyboard validates its own representative outputs; their upstream documentation alone is not evidence of runtime support.

## Provenance

Assessment used local `director` commit `cb7358b637c4cb2d03993a68a92e3a654a81a153`. No source code or bundled media was copied.
