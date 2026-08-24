import type {
  GenerationPreflight,
  ShotPlan,
} from '@h3storyboard/protocol';
import type { Node } from '@xyflow/react';
import type { StoryboardViewNode } from '../lib/storyboard-graph.js';

export interface StoryboardFlowData extends Record<string, unknown> {
  view: StoryboardViewNode;
  preflight: GenerationPreflight | null;
  busy: boolean;
  onGenerate: (
    shot: ShotPlan,
    preflight: GenerationPreflight,
    reason: string | null,
  ) => Promise<boolean>;
  onSetup: () => void;
}

export type StoryboardFlowNode = Node<StoryboardFlowData, 'storyboard'>;
