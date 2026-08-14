import type {
  CreateProjectInput,
  CreateShotPlanInput,
  CreateModeInput,
  Mode,
  ProductionBrief,
  ProjectGenerationLock,
  Project,
  ProjectSnapshot,
  UpdateModeInput,
  CreateProductionBriefInput,
  CompiledBindingsResult,
  UpdateProjectGenerationLockInput,
  UpdateShotPlanInput,
  ShotActual,
  H3Job,
  GenerationPreflight,
  CreateH3JobInput,
} from '@h3storyboard/protocol';

interface ApiEnvelope<T> {
  data: T;
}

interface ApiErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  });
  const body = (await response.json()) as ApiEnvelope<T> & ApiErrorEnvelope;

  if (!response.ok) {
    throw new ApiError(
      body.error?.code ?? 'HTTP_ERROR',
      response.status,
      body.error?.message ?? '请求失败',
    );
  }
  return body.data;
}

function isSnapshot(value: Project | ProjectSnapshot): value is ProjectSnapshot {
  return 'project' in value && 'shot_plans' in value;
}

export async function listProjects(): Promise<Project[]> {
  return request<Project[]>('/api/projects');
}

export async function getProject(projectId: string): Promise<ProjectSnapshot> {
  return request<ProjectSnapshot>(`/api/projects/${projectId}`);
}

export async function createProject(
  input: CreateProjectInput,
): Promise<ProjectSnapshot> {
  const created = await request<Project | ProjectSnapshot>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return isSnapshot(created) ? created : getProject(created.id);
}

export async function createShotPlan(
  projectId: string,
  input: CreateShotPlanInput,
): Promise<ProjectSnapshot> {
  await request<unknown>(`/api/projects/${projectId}/shots`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return getProject(projectId);
}

export async function updateShotPlan(
  input: UpdateShotPlanInput,
): Promise<ProjectSnapshot> {
  const shot = await request<{ project_id: string }>(
    `/api/shots/${input.shot_plan_id}`, {
      method: 'PATCH', body: JSON.stringify(input),
    },
  );
  return getProject(shot.project_id);
}

export async function compileShotBindings(
  shotPlanId: string,
): Promise<CompiledBindingsResult> {
  return request<CompiledBindingsResult>(
    `/api/shots/${shotPlanId}/compile_bindings`, { method: 'POST' },
  );
}

export async function markRepresentative(actualId: string,
  representative: boolean): Promise<ShotActual> {
  return request<ShotActual>(`/api/actuals/${actualId}/representative`, {
    method: 'POST', body: JSON.stringify({ representative }),
  });
}

export async function reviewRepresentative(actualId: string,
  representative_status: 'approved' | 'rejected'): Promise<ShotActual> {
  return request<ShotActual>(`/api/actuals/${actualId}/representative/review`, {
    method: 'POST', body: JSON.stringify({ representative_status }),
  });
}

export async function reviewActual(actualId: string,
  qc_verdict: 'approved' | 'rejected'): Promise<ShotActual> {
  return request<ShotActual>(`/api/actuals/${actualId}/review`, {
    method: 'POST', body: JSON.stringify({ qc_verdict }),
  });
}

export async function getGenerationPreflight(projectId: string,
  shotId: string): Promise<GenerationPreflight> {
  return request<GenerationPreflight>(`/api/projects/${projectId}/shots/${shotId}` +
    '/jobs/preflight');
}

export async function createH3Job(projectId: string, shotId: string,
  input: CreateH3JobInput): Promise<H3Job> {
  return request<H3Job>(`/api/projects/${projectId}/shots/${shotId}/jobs`, {
    method: 'POST', body: JSON.stringify(input),
  });
}

export function assetFileUrl(assetId: string): string {
  return `/api/assets/${encodeURIComponent(assetId)}/file`;
}

export * from './resource-api.js';

export async function listModes(): Promise<Mode[]> {
  return request<Mode[]>('/api/modes');
}

export async function createMode(input: CreateModeInput): Promise<Mode> {
  return request<Mode>('/api/modes', {
    method: 'POST', body: JSON.stringify(input),
  });
}

export async function updateMode(input: UpdateModeInput): Promise<Mode> {
  return request<Mode>('/api/modes', {
    method: 'PATCH', body: JSON.stringify(input),
  });
}

export async function listProductionBriefs(
  projectId: string,
): Promise<ProductionBrief[]> {
  return request<ProductionBrief[]>(`/api/projects/${projectId}/briefs`);
}

export async function createProductionBrief(projectId: string,
  input: CreateProductionBriefInput): Promise<ProductionBrief> {
  return request<ProductionBrief>(`/api/projects/${projectId}/briefs`, {
    method: 'POST', body: JSON.stringify(input),
  });
}

export async function getGenerationLock(
  projectId: string,
): Promise<ProjectGenerationLock> {
  return request<ProjectGenerationLock>(
    `/api/projects/${projectId}/generation_lock`,
  );
}

export async function updateGenerationLock(projectId: string,
  input: UpdateProjectGenerationLockInput): Promise<ProjectGenerationLock> {
  return request<ProjectGenerationLock>(
    `/api/projects/${projectId}/generation_lock`, {
      method: 'PUT', body: JSON.stringify(input),
    },
  );
}
