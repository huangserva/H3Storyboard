# H3Storyboard

Local-first storyboard and execution workbench for MiniMax H3.

The core workflow is deliberately narrow:

```text
full script -> planned storyboard -> H3 compilation -> job execution -> actual storyboard -> QC
```

Planned shots describe intent. Actual shots record generated evidence. They are separate persisted entities.

## Current milestone

The local Studio includes a structured Script Studio with two equal entry paths:
generate an editable Shuohao-shaped draft from a creator brief with an optional
OpenAI-compatible text model, or import existing plain text/Shuohao JSON. Both
paths continue through durable Scene/Beat editing, deterministic validation,
human lock, draft ShotPlan review, and explicit approval. Script generation
passes a separate fresh-context story review before it can become a draft, and
cannot contact ComfyUI, create H3 jobs, or add TTS, ambience, music, or audio.

## Workspace

- `apps/studio` — React director workbench.
- `apps/api` — local-only HTTP API bound to `127.0.0.1`.
- `packages/protocol` — script, project, shot, asset, H3 job, and QC contracts.
- `packages/project-store` — SQLite migrations and durable project state.
- `packages/h3-provider` — H3 mode and provider contract.
- `packages/task-engine` — persistent job lifecycle rules.

## Canvas test drive

Start a self-contained canvas project with real character references and two
silent H3 video Takes:

```bash
pnpm demo:canvas
```

Open `http://127.0.0.1:5174` and select `上海雨夜 · 画布体验项目`. The seed is
idempotent and uses the isolated `.h3storyboard/canvas-test.db`. This command
forces `H3_WORKER=0`: it does not contact ComfyUI or the 4090. Both bundled MP4
fixtures are checked to contain a video track and no audio track before they
are installed. The canvas supports character-reference and Take lightboxes,
Take switching, QC, and representative-Take review. Set `H3_CANVAS_DEMO_DB`
only when you intentionally want a different isolated demo database;
`H3_STORYBOARD_DB` is ignored by the seeder so an inherited production setting
cannot be polluted.

Switch the workspace to `剧本` to test Script Studio. Choose `AI 生成剧本` or
`导入已有剧本`, then edit Scene/Beat timing and continuity state, save,
validate, lock, and compile. The last action returns to the canvas and shows the
generated plans as `DRAFT`; it does not create H3 jobs or access the 4090.

The initial seed is one SQLite immediate transaction and media files are staged
with atomic renames. If an older demo database is already incomplete or its
fixture hashes no longer match, the seeder refuses it without deleting an
active database; choose a fresh `H3_CANVAS_DEMO_DB` path to recover safely.

## Development

```bash
pnpm install
pnpm dev
```

- Studio: `http://127.0.0.1:5174`
- API: `http://127.0.0.1:4187`
- Data: `~/.h3storyboard/h3storyboard.db` by default, or set `H3_STORYBOARD_DB`.

AI script generation is optional and uses one OpenAI-compatible endpoint. If
the variables are absent the Studio displays `AI 模型尚未配置` and keeps import
fully available:

```bash
H3_SCRIPT_AI_ENDPOINT=http://127.0.0.1:30000/v1 \
H3_SCRIPT_AI_MODEL=your-screenwriter-model \
H3_SCRIPT_AI_PROVIDER=local-openai-compatible \
H3_SCRIPT_AI_API_KEY=optional-key \
pnpm dev
```

`H3_SCRIPT_AI_ENDPOINT` and `H3_SCRIPT_AI_MODEL` must be set together. The API
key is optional for trusted local endpoints and is never returned to Studio.
The endpoint receives separate stateless generation and independent-review
requests; only `approve` or `approve_with_notes` review verdicts are persisted.

The API starts both the H3 video worker and character-image worker by default.
Video uses `H3_COMFY_ENDPOINT` (default `http://127.0.0.1:8190`); Krea/Qwen image
jobs use `H3_IMAGE_COMFY_ENDPOINT` (default `http://127.0.0.1:8188`). Disable one
with `H3_VIDEO_WORKER=0` or `H3_IMAGE_WORKER=0`, or both with `H3_WORKER=0` when
a separately managed process owns the database. Both workers share one durable
GPU lease and verify every configured queue before submission. A busy queue is
recorded as recoverable work without uploading or submitting. `/free` is called
only for endpoints explicitly listed in the comma-separated
`H3_MANAGED_COMFY_ENDPOINTS`; unmanaged ComfyUI processes are never released.

Production startup uses the same behavior:

```bash
pnpm build
H3_STORYBOARD_DB=/path/to/project.db \
H3_COMFY_ENDPOINT=http://127.0.0.1:8190 \
H3_IMAGE_COMFY_ENDPOINT=http://127.0.0.1:8188 \
H3_MANAGED_COMFY_ENDPOINTS=http://127.0.0.1:8188,http://127.0.0.1:8190 \
pnpm --filter @h3storyboard/api start
```

## Quality gate

```bash
pnpm check
pnpm build
pnpm test
```

See [`docs/architecture.md`](docs/architecture.md), [`docs/protocol.md`](docs/protocol.md), [`docs/plan.md`](docs/plan.md), the [M0 self-review](docs/self-review-m0.md), the [source comparison report](.hive/reports/2026-08-11-filmstoryboard-vs-xyz-video-creator.html), and the [director reference assessment](.hive/reports/2026-08-11-director-reference-assessment.html).
