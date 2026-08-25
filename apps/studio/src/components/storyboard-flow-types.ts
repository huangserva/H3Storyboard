import type {
  CharacterReference,
  GenerationPreflight,
  ShotPlan,
} from '@h3storyboard/protocol';
import type { Node } from '@xyflow/react';
import type { StoryboardViewNode } from '../lib/storyboard-graph.js';
import type { StoryboardBindingSource } from
  '../lib/storyboard-binding.js';
import type { ShotMediaSlot } from '../lib/storyboard-scene-director.js';

export interface StoryboardFlowData extends Record<string, unknown> {
  view: StoryboardViewNode;
  directorMode: boolean;
  mediaSlots: ShotMediaSlot[];
  preflight: GenerationPreflight | null;
  busy: boolean;
  characterReference: CharacterReference | null;
  bindingSources: StoryboardBindingSource[];
  onGenerate: (
    shot: ShotPlan,
    preflight: GenerationPreflight,
    reason: string | null,
  ) => Promise<boolean>;
  onSetup: () => void;
  onOpenMedia: (assetId: string) => void;
}

export type StoryboardFlowNode = Node<StoryboardFlowData, 'storyboard'>;
