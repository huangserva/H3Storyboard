# M1B-3b HybridLoader / r2v comparison evidence

Date: 2026-08-12 (Asia/Shanghai)

## Pre-change runtime audit

- H3 instance: `/home/admin01/imports/rented_175_155_64_171/ComfyUI-H3`
- Listener: `127.0.0.1:8190`, PID before installation `2369798`
- Exact cmdline: `.venv/bin/python main.py --listen 127.0.0.1 --port 8190`
- CWD: `/home/admin01/imports/rented_175_155_64_171/ComfyUI-H3`
- Python executable: `/usr/bin/python3.12` via the instance's `.venv/bin/python`
- Parent PID: 1; stdout/stderr: `/home/admin01/comfy_h3.log`
- Initial `/queue` audit: no running or pending prompts
- 8188 must not be restarted or stopped.

The exact restart command is:

```bash
cd /home/admin01/imports/rented_175_155_64_171/ComfyUI-H3
setsid .venv/bin/python main.py --listen 127.0.0.1 --port 8190 >> /home/admin01/comfy_h3.log 2>&1 < /dev/null &
```

The rollback is fixed before installation: gracefully terminate only the new
8190 PID, move
`custom_nodes/ComfyUI_MinimaxH3HybridLoader` out of `custom_nodes`, and restart
with the exact command above. No other process may be killed. Rollback is
triggered if `/system_stats` does not recover, the loader is absent from
`/object_info`, or any of the original 11 required H3 nodes disappears.

### Queue race observed during restart

The queue state changed after the initial audit. The immediate pre-SIGTERM
`jq -e` assertion printed `false`, but the compound shell lacked `set -e` and
continued to SIGTERM. After the restart, an external 362-frame H3 prompt
`0a45fb5e-4005-43fb-a2c5-1184448b9667` was present and running; an external
submitter may have recovered or resubmitted it. All M1B-3b GPU work was paused
without cancellation or `/free` until that prompt could finish naturally.
Future restart commands must use a separate, successful queue gate or explicit
`if ! ...; then exit 1; fi`; merely placing `jq -e` earlier in a multi-command
shell is insufficient.

## Source and intended installation

- Source commit: `861c7dfcf2289edf9c77177f1185f19b2f187652`
- License: MIT
- Source directory: the dispatch scratchpad clone
- Destination: `ComfyUI-H3/custom_nodes/ComfyUI_MinimaxH3HybridLoader`
- Recommended hybrid: fl2va base, ref2va overlay,
  `block_range_adaln`, blocks 30–49, no final AdaLN overlay

## Installation result

HybridLoader loaded after a six-second restart. `/object_info` exposed
`MiniMaxH3HybridLoader` with both checkpoints, all presets and blocks 30–49;
all 11 original required H3 nodes remained present. Rollback was not required.

Only 8190 was restarted. The new PID was `1970590`; the effective argv and cwd
match the audited command. 8188 and all other resident processes were left
running.

## Krea character reference

Krea 8188 generated a real Lin Lan master image directly from the verbatim
canonical appearance plus neutral portrait instructions.

- Provider task: `f056b750-8bad-4214-a191-d4d6f53346ed`
- Runtime: 18.063 seconds; GPU peak 41,183 MiB
- Output: 720×1280 PNG, 919,183 bytes
- sha256: `5414e0678a30e6a1107f41ee4e1b16f9e26f72d59dbf63608380a07f41a65c1a`
- Asset: `9c5bac48-4f3c-4d96-a111-92dd61fd001f`, approved
- Character reference: `1d631fa6-4790-4137-b86b-ae5665d375af`

The image visibly matches the black chin-length bob, amber-brown eyes,
charcoal raincoat and burgundy shirt. It replaces and archives the old fake
Lin Lan placeholder asset through the asset lifecycle; manifest v3 contains
the real reference. Binding dry-run resolves ordered slots as rainy alley
`first_frame`, then Lin Lan `reference_character`.

## Controlled r2v comparison

Both jobs share brief v2, manifest v3, mode key `r2v-hybrid`, prompt, seed
20260812, 480×864, 124 frames at 24 fps, turbo 4 steps, and the same two
compiled image bindings. Both explicitly persist
`gate_override_reason="M1B-3b hybrid comparison"`.

| Evidence | Stock ref2va | Hybrid blocks 30–49 |
|---|---:|---:|
| Job | `7a2ed666-6713-4a13-a99a-981baf4665ec` | `6fc213c6-b2ac-4d00-bcd1-0ba95c0d5fc2` |
| Provider task | `8a4a4577-d8cd-41f4-82a3-e2c54cc8eb6a` | `e773ff9b-ca0d-4880-92bc-141962ec7fba` |
| Runtime | 75.343 s | 75.103 s |
| GPU peak / min free | 46,875 / 1,627 MiB | 45,107 / 3,395 MiB |
| Output bytes | 615,580 | 811,282 |
| sha256 | `f1dcf25bd4a5db6b0c79f904112a5d09f3d29b9e13427dd62e20807b120a4363` | `8adf3b4937e574102ccd2a02b0e994d1c5913722d2d27953d56603df8cb883f6` |

Both outputs are H.264 480×864 at 24 fps plus 32kHz stereo AAC, with video
duration 5.166667 seconds and container/audio duration 5.167 seconds. File
hashes exactly match their candidate asset records; each completed job has a
pending ShotActual.

## Frame and audio review

Contact-sheet review shows a material hybrid advantage:

- Stock begins as a near-black silhouette, carries the synthetic cyan/magenta
  guide lines into the scene, and develops a heavy black pattern on the letter.
- Hybrid establishes the full rainy alley and Lin Lan immediately. Face shape,
  bob, raincoat and burgundy shirt remain closer to the approved Krea image;
  framing and wet-neon scene continuity are steadier.
- Both still show generative defects around hands and the letter. This is not
  sufficient evidence for an automatic `validated` promotion.

Audio cannot be judged subjectively in this execution surface. Objective
checks show non-silent, unclipped stereo streams: stock RMS -17.88 dB / peak
-2.86 dB; hybrid RMS -22.46 dB / peak -6.29 dB. Hybrid is about 4.6 dB quieter.
Listening clarity remains an explicit user playback check.

## Conclusion

The custom loader has no observed runtime or VRAM penalty and materially
improves this controlled reference shot. `r2v-hybrid` evidence was updated but
its status remains `candidate` pending user/orchestrator visual review. The
generation lock was released after both immutable jobs completed. An external
8190 prompt queued behind the hybrid run, so no post-run `/free` was issued;
this avoided disrupting unrelated work.
