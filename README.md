# H3Storyboard

Local-first storyboard and execution workbench for MiniMax H3.

The core workflow is deliberately narrow:

```text
full script -> planned storyboard -> H3 compilation -> job execution -> actual storyboard -> QC
```

Planned shots describe intent. Actual shots record generated evidence. They are separate persisted entities.

## Current milestone

M0 is the durable foundation: protocol, SQLite migrations, local API, task leases, continuity lineage, QC, and the Studio shell. The real ComfyUI/MiniMax submit-and-poll worker is deliberately M1; this repository does not yet claim end-to-end H3 generation.

## Workspace

- `apps/studio` — React director workbench.
- `apps/api` — local-only HTTP API bound to `127.0.0.1`.
- `packages/protocol` — project, shot, asset, H3 job, and QC contracts.
- `packages/project-store` — SQLite migrations and durable project state.
- `packages/h3-provider` — H3 mode and provider contract.
- `packages/task-engine` — persistent job lifecycle rules.

## Development

```bash
pnpm install
pnpm dev
```

- Studio: `http://127.0.0.1:5174`
- API: `http://127.0.0.1:4187`
- Data: `~/.h3storyboard/h3storyboard.db` by default, or set `H3_STORYBOARD_DB`.

## Quality gate

```bash
pnpm check
pnpm build
pnpm test
```

See [`docs/architecture.md`](docs/architecture.md), [`docs/protocol.md`](docs/protocol.md), [`docs/plan.md`](docs/plan.md), the [M0 self-review](docs/self-review-m0.md), the [source comparison report](.hive/reports/2026-08-11-filmstoryboard-vs-xyz-video-creator.html), and the [director reference assessment](.hive/reports/2026-08-11-director-reference-assessment.html).
