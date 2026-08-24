import { describe, expect, it } from 'vitest';
import {
  CreateAssetInputSchema,
  CreateH3JobInputSchema,
  CreateShotPlanInputSchema,
  type AssetBinding,
  validateH3Bindings,
} from '@h3storyboard/protocol';

const id = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`;

const binding = (
  suffix: number,
  role: AssetBinding['role'],
  assetKind: AssetBinding['asset_kind'],
): AssetBinding => ({
  asset_id: id(suffix),
  asset_kind: assetKind,
  role,
  ordinal: suffix - 1,
});

describe('H3 binding contracts', () => {
  it.each([
    ['t2v', []],
    ['i2v', [binding(1, 'first_frame', 'image')]],
    [
      'fl2v',
      [
        binding(1, 'first_frame', 'image'),
        binding(2, 'last_frame', 'image'),
      ],
    ],
    ['r2v', [binding(1, 'character', 'image')]],
    ['v2v', [binding(1, 'motion', 'video')]],
    [
      'rv2v',
      [
        binding(1, 'character', 'image'),
        binding(2, 'motion', 'video'),
      ],
    ],
  ] as const)('accepts the minimum valid %s bindings', (mode, bindings) => {
    expect(validateH3Bindings(mode, [...bindings])).toEqual([]);
  });

  it('rejects fl2v without a last frame before a job can be persisted', () => {
    const result = CreateH3JobInputSchema.safeParse({
      mode: 'fl2v',
      provider: 'local_comfyui',
      model: 'H3',
      prompt: '镜头从人物中景平稳推进到面部特写',
      duration_seconds: 6,
      seed: 1,
      steps: 20,
      idempotency_key: 'shot-001-attempt-001',
      input_bindings: [binding(1, 'first_frame', 'image')],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(
        'H3_MODE_BINDING_MISMATCH',
      );
    }
  });

  it('rejects ambiguous upload and prompt ordering', () => {
    const issues = validateH3Bindings('rv2v', [
      { ...binding(1, 'character', 'image'), ordinal: 1 },
      { ...binding(2, 'motion', 'video'), ordinal: 1 },
    ]);

    expect(issues.map(({ code }) => code)).toContain(
      'BINDING_ORDINAL_SEQUENCE_INVALID',
    );
  });

  it('rejects external audio because final output is H3-native or silent', () => {
    expect(
      validateH3Bindings('i2v', [
        binding(1, 'first_frame', 'image'),
        binding(2, 'audio', 'audio'),
      ]).map(({ code }) => code),
    ).toContain('H3_EXTERNAL_AUDIO_FORBIDDEN');
  });

  it('rejects role-kind mismatches and duplicate boundary roles', () => {
    expect(
      validateH3Bindings('r2v', [binding(1, 'character', 'video')]).map(
        ({ code }) => code,
      ),
    ).toContain('ASSET_ROLE_KIND_MISMATCH');
    expect(
      validateH3Bindings('r2v', [
        binding(1, 'first_frame', 'image'),
        binding(2, 'first_frame', 'image'),
      ]).map(({ code }) => code),
    ).toContain('DUPLICATE_FRAME_ROLE');
  });

  it('enforces per-kind and mixed upload limits', () => {
    const images = Array.from({ length: 10 }, (_, index) =>
      binding(index + 1, 'character', 'image'),
    );
    expect(validateH3Bindings('r2v', images).map(({ code }) => code)).toContain(
      'H3_ASSET_TYPE_LIMIT_EXCEEDED',
    );
    const videos = Array.from({ length: 4 }, (_, index) =>
      binding(index + 1, 'motion', 'video'),
    );
    expect(validateH3Bindings('v2v', videos).map(({ code }) => code)).toContain(
      'H3_ASSET_TYPE_LIMIT_EXCEEDED',
    );

    const mixed = [
      ...Array.from({ length: 8 }, (_, index) =>
        binding(index + 1, 'character', 'image'),
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        binding(index + 9, 'motion', 'video'),
      ),
      ...Array.from({ length: 2 }, (_, index) =>
        binding(index + 12, 'audio', 'audio'),
      ),
    ];
    expect(validateH3Bindings('rv2v', mixed).map(({ code }) => code)).toContain(
      'H3_TOTAL_ASSET_LIMIT_EXCEEDED',
    );

    const excessiveAudio = [
      binding(1, 'character', 'image'),
      ...Array.from({ length: 4 }, (_, index) =>
        binding(index + 2, 'audio', 'audio'),
      ),
    ];
    expect(
      validateH3Bindings('r2v', excessiveAudio).map(({ code }) => code),
    ).toContain('H3_ASSET_TYPE_LIMIT_EXCEEDED');
  });
});

describe('continuity protocol', () => {
  it('rejects external audio when a new shot plan is authored', () => {
    const result = CreateShotPlanInputSchema.safeParse({
      title: 'silent plan', scene_id: 'SC-1', duration_seconds: 6,
      shot_size: 'medium', camera_movement: 'locked',
      action: 'A person crosses the frame.',
      reference_bindings: [binding(1, 'audio', 'audio')],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map(({ message }) => message))
      .toContainEqual(expect.stringContaining('H3_EXTERNAL_AUDIO_FORBIDDEN'));
  });

  it('requires every continuity dependency asset in the upload bindings', () => {
    const result = CreateShotPlanInputSchema.safeParse({
      title: 'continued shot',
      scene_id: 'SC-2',
      duration_seconds: 6,
      shot_size: 'medium',
      camera_movement: 'locked',
      action: 'The action continues.',
      continuity_mode: 'visual_match',
      continuity_dependencies: [
        {
          source_shot_plan_id: id(10),
          source_take_id: id(11),
          reference_asset_id: id(12),
          boundary: 'last_frame',
        },
      ],
      reference_bindings: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(
        'CONTINUITY_BINDING_MISSING',
      );
    }
  });
});

describe('project-scoped asset paths', () => {
  it.each(['../outside.png', 'refs/../../outside.png', 'C:\\outside.png']) (
    'rejects %s',
    (relativePath) => {
      expect(
        CreateAssetInputSchema.safeParse({
          kind: 'image',
          name: 'unsafe',
          relative_path: relativePath,
          content_hash: 'sha256:unsafe',
        }).success,
      ).toBe(false);
    },
  );
});
