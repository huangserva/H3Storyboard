# M1B-3a real H3 i2v smoke evidence

Date: 2026-08-12 (Asia/Shanghai)

## Scope

Validate one real “雨夜来信” shot through the M1A production contract and the
M1B-2 lease worker. HybridLoader/r2v was intentionally excluded.

## Inputs and immutable context

- Project: `e9badbbe-8e95-41af-9000-8f677432ef6d`
- Shot: `2e32f7b8-87c7-499d-a5cf-b33d95c72864`
- Real first-frame asset: `c41c1023-27a9-4cf5-a280-66b8c2dad068`
- First-frame sha256: `a303dd5daa99d47f5364825242819bb276efea3f9983139154d49088a7f9b006`
- Manifest version: 2; brief version: 1; mode key: `cinematic-drama`
- Job: `63381891-c1c4-41b4-bd18-27a905045639`
- Compiled mode/bindings: `i2v`, one ordered `first_frame` binding
- Settings: 480×864, 124 frames at 24 fps, turbo, 4 steps, seed 20260812,
  audio enabled. Prompt was English and contained no `Audio:` CJK line.

The first frame was produced with the task's permitted local ffmpeg fallback,
then registered through the API with a real relative path and hash. No fake
character reference remained in the shot binding.

## Runtime evidence

Both ComfyUI endpoints received `/free` before submission. Free VRAM rose from
about 12.3 GiB to 32.6 GiB. No process was killed or restarted.

- H3 endpoint: `http://127.0.0.1:8190`
- Provider task: `b41e6e4f-f3d9-43a3-be39-9337ff0dbd61`
- Submit-to-completed elapsed time: 75.644 seconds
- Worker result: `completed`; error callback count: 0
- GPU peak used: 45,667 MiB; minimum free: 2,835 MiB
- GPU utilization peak: 100%; samples: 38 at two-second intervals

## Output and persistence evidence

- Relative output: `projects/e9badbbe-8e95-41af-9000-8f677432ef6d/outputs/63381891-c1c4-41b4-bd18-27a905045639.mp4`
- Size: 632,806 bytes
- sha256: `59b4fb1bc4a22f2da396a6641a25a244c2869e4ce743f457a57233d5d6182f05`
- ffprobe: H.264 video, 480×864, 24 fps, 5.166667 s; AAC audio,
  5.167 s; MP4 duration 5.167 s
- Output asset: `a352c3e8-ba33-44ad-82f6-287e90ff3dda`, `candidate`, with
  matching true content hash and `producer_job_id`
- ShotActual: `eecabb3e-a75f-4228-80d0-a6435670d4d9`, attempt 2,
  `qc_verdict=pending`

The job is `completed`, retains lock snapshot `{brief_version: 1,
manifest_version: 2, mode_key: cinematic-drama}`, and retains its compiled
binding. The generation lock was released after completion. Mode evidence was
updated with this result while validation status deliberately remains
`candidate`; broader validation and the r2v comparison belong to M1B-3b.

## Conclusion

The normal real-machine path is verified end to end: authoritative manifest
input, deterministic binding, immutable lock snapshot, submit-once provider
task, media download, non-empty validation, true hash, canonical candidate
asset, pending actual, then completed job. Recovery remains integration-tested
with the contract stub; it was not artificially induced during this real run.
