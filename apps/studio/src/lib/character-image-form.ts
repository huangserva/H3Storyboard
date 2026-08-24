import type {
  CharacterImageOperation,
  CreateCharacterImageJobInput,
} from '@h3storyboard/protocol';

export interface CharacterImageFormValues {
  operation: CharacterImageOperation;
  prompt: string;
  seed: number;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  denoise: number | null;
  source_reference_ids: string[];
}

export const CHARACTER_IMAGE_OPERATION_LABELS: Record<
  CharacterImageOperation, string> = {
  master_t2i: 'Krea 母图 T2I',
  identity_edit: 'Qwen 身份编辑',
  variant_i2i: 'Krea 轻派生',
};

export function characterImageDefaults(operation: CharacterImageOperation) {
  if (operation === 'identity_edit') return {
    engine: 'qwen_image_edit_2511' as const,
    steps: 4, cfg: 1, sampler: 'euler', scheduler: 'simple', denoise: 1,
  };
  return {
    engine: 'krea2' as const,
    steps: 8, cfg: 1, sampler: 'euler_ancestral', scheduler: 'sgm_uniform',
    denoise: operation === 'master_t2i' ? null : 0.52,
  };
}

export function buildCharacterImageJobInput(
  values: CharacterImageFormValues,
  idempotencyKey = `studio-image-${crypto.randomUUID()}`,
): CreateCharacterImageJobInput {
  const defaults = characterImageDefaults(values.operation);
  return {
    operation: values.operation,
    provider: 'local_comfyui',
    engine: defaults.engine,
    prompt: values.prompt.trim(),
    seed: values.seed,
    width: values.width,
    height: values.height,
    steps: values.steps,
    cfg: values.cfg,
    sampler: values.sampler.trim(),
    scheduler: values.scheduler.trim(),
    denoise: values.operation === 'master_t2i' ? null : values.denoise,
    lora_profile: null,
    lora_name: null,
    lora_strength: null,
    source_reference_ids: values.operation === 'master_t2i'
      ? [] : values.source_reference_ids,
    idempotency_key: idempotencyKey,
  };
}
