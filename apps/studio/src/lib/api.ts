import type {
  CanvasNode,
  CreateCanvasNodeInput,
  CreateProjectInput,
  CreateShotPlanInput,
  Project,
  ProjectSnapshot,
  UpdateCanvasNodeInput,
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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

export async function listCanvasNodes(projectId: string): Promise<CanvasNode[]> {
  return request<CanvasNode[]>(`/api/projects/${projectId}/canvas_nodes`);
}

export async function createCanvasNode(
  projectId: string,
  input: CreateCanvasNodeInput,
): Promise<CanvasNode> {
  return request<CanvasNode>(`/api/projects/${projectId}/canvas_nodes`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateCanvasNode(
  projectId: string,
  input: UpdateCanvasNodeInput,
): Promise<CanvasNode> {
  return request<CanvasNode>(`/api/projects/${projectId}/canvas_nodes`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
