import type {
  Asset,
  Character,
  H3Job,
  Project,
  ScriptVersion,
  ShotActual,
  ShotPlan,
} from '@h3storyboard/protocol';

export type StoryboardNodeKind =
  | 'script' | 'scene' | 'asset' | 'character' | 'shot' | 'job' | 'take';
export type StoryboardEdgeKind =
  | 'structure' | 'reference' | 'identity' | 'generation' | 'output' | 'continuity';

interface ViewNodeBase {
  id: string;
  kind: StoryboardNodeKind;
  entity_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z_index: number;
  persisted_node_id: string | null;
  title: string;
  kicker: string;
  summary: string;
  status: string;
  approved: boolean;
  preview_asset_id: string | null;
  shot_id: string | null;
}

export type StoryboardViewNode = ViewNodeBase & {
  project?: Project;
  script?: ScriptVersion;
  scene_id?: string;
  asset?: Asset;
  asset_role?: 'reference' | 'output';
  preview_asset?: Asset | null;
  character?: Character;
  shot?: ShotPlan;
  shot_jobs?: H3Job[];
  shot_actuals?: ShotActual[];
  job?: H3Job;
  take?: ShotActual;
};

export interface StoryboardViewEdge {
  id: string;
  source: string;
  target: string;
  kind: StoryboardEdgeKind;
  label: string;
  animated: boolean;
}

export interface StoryboardGraph {
  nodes: StoryboardViewNode[];
  edges: StoryboardViewEdge[];
}
