import type {
  BindShotReferenceInput,
  ProjectSnapshot,
} from '@h3storyboard/protocol';
import type { StoryboardViewNode } from './storyboard-graph.js';

export type ShotBindingTarget =
  | 'first_frame'
  | 'last_frame'
  | 'reference_character';

export type StoryboardBindingSource =
  | { kind: 'asset'; asset_id: string; handle_id: string; label: string }
  | { kind: 'character'; character_id: string; handle_id: string; label: string }
  | { kind: 'continuity'; source_shot_plan_id: string; source_take_id: string;
    reference_asset_id: string; boundary: 'first_frame' | 'last_frame';
    handle_id: string; label: string };

export function selectStoryboardBindingSources(
  view: StoryboardViewNode,
  snapshot: ProjectSnapshot,
): StoryboardBindingSource[] {
  if (view.kind === 'asset' && view.asset?.kind === 'image' &&
    view.asset.status !== 'archived' && view.asset_role === 'reference') {
    return [{ kind: 'asset', asset_id: view.asset.id,
      handle_id: 'bind:asset', label: '参考图' }];
  }
  if (view.kind === 'character' && view.character &&
    view.character.status !== 'archived') {
    return [{ kind: 'character', character_id: view.character.id,
      handle_id: 'bind:character', label: '角色' }];
  }
  if (view.kind !== 'take' || !view.take || !view.shot_id ||
    view.take.qc_verdict !== 'approved') return [];
  const output = snapshot.assets.find(
    ({ id }) => id === view.take!.output_asset_id);
  if (!output) return [];
  return snapshot.assets.flatMap((asset): StoryboardBindingSource[] => {
    const boundary = asset.derivation_kind;
    if (asset.kind !== 'image' || asset.status === 'archived' ||
      asset.derived_from_asset_id !== output.id ||
      (boundary !== 'first_frame' && boundary !== 'last_frame')) return [];
    return [{ kind: 'continuity' as const,
      source_shot_plan_id: view.shot_id!, source_take_id: view.take!.id,
      reference_asset_id: asset.id, boundary,
      handle_id: `bind:continuity:${boundary}:${asset.id}`,
      label: boundary === 'first_frame' ? 'Take 首帧' : 'Take 尾帧',
    }];
  });
}

export function buildShotBinding(
  source: StoryboardBindingSource,
  purpose: ShotBindingTarget,
  targetShotId: string,
): BindShotReferenceInput | null {
  if (source.kind === 'character') {
    return purpose === 'reference_character' ? {
      binding_type: 'semantic', purpose,
      target: { type: 'character', character_id: source.character_id },
    } : null;
  }
  if (source.kind === 'asset') {
    return purpose === 'reference_character' || purpose === 'first_frame' ||
      purpose === 'last_frame' ? {
        binding_type: 'semantic', purpose,
        target: { type: 'asset', asset_id: source.asset_id },
      } : null;
  }
  if (source.source_shot_plan_id === targetShotId ||
    (purpose !== 'first_frame' && purpose !== 'last_frame')) return null;
  return { binding_type: 'continuity', purpose,
    source_shot_plan_id: source.source_shot_plan_id,
    source_take_id: source.source_take_id,
    reference_asset_id: source.reference_asset_id,
    boundary: source.boundary };
}
