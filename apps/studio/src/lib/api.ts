import type {
  Asset,
  CanvasNode,
  Character,
  CreateAssetInput,
  CreateCharacterInput,
  CreateCanvasNodeInput,
  CreateProjectInput,
  CreateShotPlanInput,
  CurrentAssetsManifestSnapshot,
  CreateModeInput,
  Mode,
  ProductionBrief,
  ProjectGenerationLock,
  Project,
  ProjectSnapshot,
  UpdateCanvasNodeInput,
  UpdateAssetInput,
  UpdateModeInput,
  CreateProductionBriefInput,
  CompiledBindingsResult,
  UpdateProjectGenerationLockInput,
  UpdateCharacterInput,
  UpdateShotPlanInput,
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

export async function listCharacters(projectId: string): Promise<Character[]> {
  return request<Character[]>(`/api/projects/${projectId}/characters`);
}

export async function createCharacter(
  projectId: string,
  input: CreateCharacterInput,
): Promise<Character> {
  return request<Character>(`/api/projects/${projectId}/characters`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateCharacter(
  projectId: string,
  input: UpdateCharacterInput,
): Promise<Character> {
  return request<Character>(`/api/projects/${projectId}/characters`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function listAssets(projectId: string): Promise<Asset[]> {
  return request<Asset[]>(`/api/projects/${projectId}/assets`);
}

export async function createAsset(
  projectId: string,
  input: CreateAssetInput,
): Promise<Asset> {
  return request<Asset>(`/api/projects/${projectId}/assets`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateAsset(
  projectId: string,
  input: UpdateAssetInput,
): Promise<Asset> {
  return request<Asset>(`/api/projects/${projectId}/assets`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function listAssetManifests(
  projectId: string,
): Promise<CurrentAssetsManifestSnapshot[]> {
  return request<CurrentAssetsManifestSnapshot[]>(
    `/api/projects/${projectId}/manifests`,
  );
}

export async function freezeAssetManifest(
  projectId: string,
): Promise<CurrentAssetsManifestSnapshot> {
  return request<CurrentAssetsManifestSnapshot>(
    `/api/projects/${projectId}/manifests`, { method: 'POST' },
  );
}

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
