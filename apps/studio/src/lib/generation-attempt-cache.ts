import type { CreateH3JobBatchInput, CreateH3JobInput,
  GenerationPreflight, ShotPlan } from '@h3storyboard/protocol';

interface BatchAttempt {
  key: string;
  input: CreateH3JobBatchInput;
}

export class H3BatchAttemptCache {
  readonly #attempts = new Map<string, CreateH3JobBatchInput>();

  prepare(shots: ShotPlan[], preflights: Map<string, GenerationPreflight>,
    gateOverrideReason: string | null): BatchAttempt {
    const key = JSON.stringify(shots.map((shot) => {
      const preflight = preflights.get(shot.id);
      if (!preflight?.ready || !preflight.mode) throw new Error(
        `Shot ${shot.id} is not ready for H3 batch generation`);
      return { id: shot.id, prompt: shot.prompt,
        duration_seconds: shot.duration_seconds, mode: preflight.mode,
        input_bindings: preflight.input_bindings,
        gate_override_reason: gateOverrideReason };
    }));
    const existing = this.#attempts.get(key);
    if (existing) return { key, input: existing };
    const input = { items: shots.map((shot) => ({ shot_plan_id: shot.id,
      job: generationInput(shot, preflights.get(shot.id)!, gateOverrideReason),
    })) };
    this.#attempts.set(key, input);
    if (this.#attempts.size > 16) {
      const oldest = this.#attempts.keys().next().value;
      if (oldest !== undefined) this.#attempts.delete(oldest);
    }
    return { key, input };
  }

  complete(key: string): void { this.#attempts.delete(key); }
}

export function generationInput(shot: ShotPlan, preflight: GenerationPreflight,
  gateOverrideReason: string | null): CreateH3JobInput {
  if (!preflight.mode) throw new Error('Generation preflight has no mode');
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return { mode: preflight.mode, provider: 'local_comfyui', model: 'H3-local',
    prompt: shot.prompt, duration_seconds: shot.duration_seconds, seed, steps: 4,
    audio_mode: 'h3_native', idempotency_key: `studio-${crypto.randomUUID()}`,
    input_bindings: preflight.input_bindings,
    ...(gateOverrideReason ? { gate_override_reason: gateOverrideReason } : {}) };
}
