import { z } from 'zod';
import { AssetSchema } from './common.js';
import { H3JobSchema } from './h3-job.js';
import { ProjectSchema, ScriptVersionSchema } from './project.js';
import { ShotActualSchema, ShotPlanSchema } from './shot.js';

export const ProjectSnapshotSchema = z.object({
  project: ProjectSchema,
  script_version: ScriptVersionSchema,
  assets: z.array(AssetSchema),
  shot_plans: z.array(ShotPlanSchema),
  shot_actuals: z.array(ShotActualSchema),
  h3_jobs: z.array(H3JobSchema),
});
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>;
