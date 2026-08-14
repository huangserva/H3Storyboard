# H3Storyboard

Local-first storyboard and execution workbench for MiniMax H3.

The core workflow is deliberately narrow:

```text
full script -> planned storyboard -> H3 compilation -> job execution -> actual storyboard -> QC
```

Planned shots describe intent. Actual shots record generated evidence. They are separate persisted entities.

## Current milestone

The local Studio now creates immutable H3 jobs, shows worker progress, and reveals
the candidate video and pending Take when generation completes. Planned shots and
generated results remain separate records until explicit QC.

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

The API starts `H3LeaseWorker` by default and connects to
`http://127.0.0.1:8190`. Override the endpoint with `H3_COMFY_ENDPOINT`; set
`H3_WORKER=0` only when a separately managed worker owns this database. Before a
new submission the worker verifies that ComfyUI's running and pending queues are
both empty. If another application occupies the queue it records a recoverable
wait state and does not call `/free`, upload inputs, or submit a prompt. Once the
queue is free, it calls `/free` before loading the H3 model and submitting.

Production startup uses the same behavior:

```bash
pnpm build
H3_STORYBOARD_DB=/path/to/project.db \
H3_COMFY_ENDPOINT=http://127.0.0.1:8190 \
pnpm --filter @h3storyboard/api start
```

## Quality gate

```bash
pnpm check
pnpm build
pnpm test
```

See [`docs/architecture.md`](docs/architecture.md), [`docs/protocol.md`](docs/protocol.md), [`docs/plan.md`](docs/plan.md), the [M0 self-review](docs/self-review-m0.md), the [source comparison report](.hive/reports/2026-08-11-filmstoryboard-vs-xyz-video-creator.html), and the [director reference assessment](.hive/reports/2026-08-11-director-reference-assessment.html).
