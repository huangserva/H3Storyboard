import type {
  CharacterReference,
  GenerationPreflight,
  ShotPlan,
} from '@h3storyboard/protocol';
import type { Node } from '@xyflow/react';
import type { StoryboardViewNode } from '../lib/storyboard-graph.js';

export interface StoryboardFlowData extends Record<string, unknown> {
  view: StoryboardViewNode;
  preflight: GenerationPreflight | null;
  busy: boolean;
  characterReference: CharacterReference | null;
  onGenerate: (
    shot: ShotPlan,
    preflight: GenerationPreflight,
    reason: string | null,
  ) => Promise<boolean>;
  onSetup: () => void;
  onOpenMedia: (assetId: string) => void;
}

export type StoryboardFlowNode = Node<StoryboardFlowData, 'storyboard'>;
