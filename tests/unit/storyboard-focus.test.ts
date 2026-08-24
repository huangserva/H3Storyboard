import { describe, expect, it } from 'vitest';
import { selectCanvasFocusNodeId } from
  '../../apps/studio/src/lib/storyboard-focus.js';
import type { StoryboardViewNode } from
  '../../apps/studio/src/lib/storyboard-graph.js';

const scene = node({ id: 'scene:SC-01', kind: 'scene', entity_id: 'SC-01',
  scene_id: 'SC-01' });
const shot = node({ id: 'shot:shot-1', kind: 'shot', entity_id: 'shot-1',
  shot_id: 'shot-1', scene_id: 'SC-01' });
const take = node({ id: 'take:take-1', kind: 'take', entity_id: 'take-1',
  shot_id: 'shot-1' });
const character = node({ id: 'character:character-1', kind: 'character',
  entity_id: 'character-1' });
const nodes = [scene, shot, take, character];

describe('storyboard scene focus', () => {
  it('focuses the selected shot on its containing scene', () => {
    expect(selectCanvasFocusNodeId(nodes, shot.id, 'SC-01')).toBe(scene.id);
  });

  it('uses the active scene when the pane has no selected node', () => {
    expect(selectCanvasFocusNodeId(nodes, null, 'SC-01')).toBe(scene.id);
  });

  it('keeps lineage and non-shot business nodes as direct focus targets', () => {
    expect(selectCanvasFocusNodeId(nodes, take.id, 'SC-01')).toBe(take.id);
    expect(selectCanvasFocusNodeId(nodes, character.id, 'SC-01'))
      .toBe(character.id);
  });
});

function node(overrides: Partial<StoryboardViewNode> & Pick<StoryboardViewNode,
  'id' | 'kind' | 'entity_id'>): StoryboardViewNode {
  return { x: 0, y: 0, width: 100, height: 100, z_index: 0,
    persisted_node_id: null, title: overrides.id, kicker: overrides.kind,
    summary: '', status: 'planned', approved: false, preview_asset_id: null,
    shot_id: null, ...overrides };
}
