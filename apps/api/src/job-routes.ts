import { CreateH3JobBatchInputSchema, CreateH3JobBatchResultSchema,
  CreateH3JobInputSchema, GenerationPreflightBatchSchema,
  H3JobBatchListSchema, H3JobBatchSchema, RetryH3JobInputSchema,
  RetryH3JobResultSchema,
  type GenerationPreflight,
  type GenerationPreflightBatch, type ProjectSnapshot } from '@h3storyboard/protocol';
import { StoreError, type BindingCompilationOutcome,
  type ProjectStore } from '@h3storyboard/project-store';
import type { IncomingMessage } from 'node:http';
import { ApiError, parseResponseContract } from './api-error.js';
import { readJson } from './http.js';

interface JobRouteResult { status: number; body: unknown }

const JOBS = /^\/api\/projects\/([^/]+)\/shots\/([^/]+)\/jobs$/;
const PREFLIGHT = /^\/api\/projects\/([^/]+)\/shots\/([^/]+)\/jobs\/preflight$/;
const BATCH_PREFLIGHT = /^\/api\/projects\/([^/]+)\/jobs\/preflights$/;
const BATCH_JOBS = /^\/api\/projects\/([^/]+)\/jobs\/batch$/;
const BATCH_LIST = /^\/api\/projects\/([^/]+)\/job_batches$/;
const BATCH_DETAIL = /^\/api\/projects\/([^/]+)\/job_batches\/([^/]+)$/;
const RETRY_JOB = /^\/api\/projects\/([^/]+)\/h3_jobs\/([^/]+)\/retry$/;

export async function dispatchJobRoute(request: IncomingMessage,
  store: ProjectStore, method: string,
  pathname: string): Promise<JobRouteResult | null> {
  const batchPreflight = BATCH_PREFLIGHT.exec(pathname);
  const batchDetail = BATCH_DETAIL.exec(pathname);
  if (batchDetail && method === 'GET') {
    const projectId = decode(batchDetail[1] ?? '', 'project_id');
    const batchId = decode(batchDetail[2] ?? '', 'batch_id');
    return { status: 200, body: parseResponseContract(H3JobBatchSchema,
      store.getH3JobBatch(projectId, batchId)) };
  }
  const batchList = BATCH_LIST.exec(pathname);
  if (batchList && method === 'GET') {
    const projectId = decode(batchList[1] ?? '', 'project_id');
    return { status: 200, body: parseResponseContract(H3JobBatchListSchema,
      store.listH3JobBatches(projectId)) };
  }
  const retryJob = RETRY_JOB.exec(pathname);
  if (retryJob && method === 'POST') {
    const projectId = decode(retryJob[1] ?? '', 'project_id');
    const jobId = decode(retryJob[2] ?? '', 'job_id');
    const parsed = RetryH3JobInputSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ApiError(422, 'H3_RETRY_INPUT_INVALID',
      'H3 retry input does not satisfy the contract', parsed.error.issues);
    return { status: 201, body: parseResponseContract(RetryH3JobResultSchema,
      store.retryH3Job(projectId, jobId, parsed.data)) };
  }
  if (batchPreflight && method === 'GET') {
    const projectId = decode(batchPreflight[1] ?? '', 'project_id');
    const read = store.production.readPreflightBatch(projectId);
    const context = preflightContext(read.snapshot,
      read.lock_engaged, read.has_brief);
    const compilations = new Map(read.compilations.map(
        (outcome) => [outcome.shot_plan_id, outcome]));
    const body: GenerationPreflightBatch = { project_id: projectId,
      items: read.snapshot.shot_plans.map(({ id }) => ({ shot_plan_id: id,
        preflight: generationPreflight(store, id, context,
          compilations.get(id)) })) };
    return { status: 200,
      body: parseResponseContract(GenerationPreflightBatchSchema, body) };
  }
  const batchJobs = BATCH_JOBS.exec(pathname);
  if (batchJobs && method === 'POST') {
    const projectId = decode(batchJobs[1] ?? '', 'project_id');
    const parsed = CreateH3JobBatchInputSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ApiError(422, 'H3_BATCH_INVALID',
      'H3 job batch does not satisfy the provider contract',
      parsed.error.issues);
    const unavailable = parsed.data.items.find(({ job }) =>
      job.provider === 'local_comfyui' && !isWorkerMode(job.mode));
    if (unavailable) throw new ApiError(409, 'H3_MODE_UNAVAILABLE',
      `本机常驻 worker 尚不支持 ${unavailable.job.mode}，请调整 Production Mode`);
    return { status: 201, body: parseResponseContract(
      CreateH3JobBatchResultSchema,
      store.createH3JobBatch(projectId, parsed.data)) };
  }
  const preflight = PREFLIGHT.exec(pathname);
  if (preflight && method === 'GET') {
    const { projectId, shotId, snapshot } = scopedShot(
      store, preflight[1] ?? '', preflight[2] ?? '');
    return { status: 200, body: generationPreflight(
      store, shotId, preflightContext(snapshot,
        store.production.getLock(projectId).engaged,
        store.production.listBriefs(projectId).length > 0)) };
  }
  const jobs = JOBS.exec(pathname);
  if (!jobs || method !== 'POST') return null;
  const { shotId } = scopedShot(store, jobs[1] ?? '', jobs[2] ?? '');
  const parsed = CreateH3JobInputSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(422, 'H3_BINDINGS_INVALID',
    'H3 job input does not satisfy the provider contract', parsed.error.issues);
  const projectId = decode(jobs[1] ?? '', 'project_id');
  const snapshot = store.getProjectSnapshot(projectId);
  const readiness = generationPreflight(store, shotId,
    preflightContext(snapshot, store.production.getLock(projectId).engaged,
      store.production.listBriefs(projectId).length > 0));
  if (readiness.ready && parsed.data.provider === 'local_comfyui' &&
    !isWorkerMode(parsed.data.mode)) throw new ApiError(409,
      'H3_MODE_UNAVAILABLE',
      `本机常驻 worker 尚不支持 ${parsed.data.mode}，请调整 Production Mode`);
  return { status: 201, body: store.createH3Job(shotId, parsed.data) };
}

function scopedShot(store: ProjectStore, rawProjectId: string,
  rawShotId: string): { projectId: string; shotId: string;
    snapshot: ProjectSnapshot } {
  const projectId = decode(rawProjectId, 'project_id');
  const shotId = decode(rawShotId, 'shot_id');
  const snapshot = store.getProjectSnapshot(projectId);
  const shot = snapshot.shot_plans.find(({ id }) => id === shotId);
  if (!shot) {
    try { store.production.compileBindings(shotId); }
    catch (error) {
      if (error instanceof StoreError && error.code === 'SHOT_PLAN_NOT_FOUND') {
        throw error;
      }
    }
    throw new StoreError('SHOT_PROJECT_MISMATCH',
      'Shot plan does not belong to the requested project', {
        project_id: projectId, shot_id: shotId,
      });
  }
  return { projectId, shotId, snapshot };
}

interface PreflightContext {
  readonly lock_engaged: boolean;
  readonly has_brief: boolean;
  readonly unavailable_shots: ReadonlyMap<string, string>;
  readonly jobs_by_shot: ReadonlySet<string>;
  readonly approved_representatives_by_shot: ReadonlySet<string>;
  readonly assets_by_id: ReadonlyMap<string, ProjectSnapshot['assets'][number]>;
}

function preflightContext(snapshot: ProjectSnapshot, lockEngaged: boolean,
  hasBrief: boolean): PreflightContext {
  return {
    lock_engaged: lockEngaged,
    has_brief: hasBrief,
    unavailable_shots: new Map(snapshot.shot_plans
      .filter(({ planning_status }) => planning_status !== 'approved')
      .map(({ id, planning_status }) => [id, planning_status])),
    jobs_by_shot: new Set(snapshot.h3_jobs.map(({ shot_plan_id }) => shot_plan_id)),
    approved_representatives_by_shot: new Set(snapshot.shot_actuals
      .filter(({ is_representative, representative_status }) =>
        is_representative && representative_status === 'approved')
      .map(({ shot_plan_id }) => shot_plan_id)),
    assets_by_id: new Map(snapshot.assets.map((asset) => [asset.id, asset])),
  };
}

function generationPreflight(store: ProjectStore, shotId: string,
  context: PreflightContext,
  compilation?: BindingCompilationOutcome): GenerationPreflight {
  const planningStatus = context.unavailable_shots.get(shotId);
  if (planningStatus) return blocked('SHOT_PLAN_DRAFT',
    planningStatus === 'draft'
      ? '剧本编译镜头仍为草稿，需导演批准后才能生成'
      : '该计划镜头已被后续版本取代');
  if (!context.lock_engaged) return blocked('LOCK_REQUIRED',
    !context.has_brief
      ? '请先建立 Production Brief 并锁定生成上下文'
      : '请先锁定 Production Brief 与当前资产清单');
  try {
    if (compilation?.error) throw compilation.error;
    const compiled = compilation?.compiled ??
      store.production.compileBindings(shotId);
    if (!isWorkerMode(compiled.generation_mode)) return blocked(
      'H3_MODE_UNAVAILABLE',
      `本机常驻 worker 尚不支持 ${compiled.generation_mode}，请调整 Production Mode`);
    return { ready: true, blocking_error: null,
      mode: compiled.generation_mode, input_bindings: compiled.bindings.map(
        ({ asset_id, purpose }, ordinal) => {
          const asset = context.assets_by_id.get(asset_id);
          if (!asset) throw new StoreError('ASSET_NOT_FOUND',
            'Compiled binding asset does not exist in the project snapshot', {
              shot_plan_id: shotId, asset_id,
            });
          return { asset_id, asset_kind: asset.kind,
            role: purposeRole[purpose], ordinal };
        }),
      gate_override_required: context.jobs_by_shot.has(shotId) &&
        !context.approved_representatives_by_shot.has(shotId) };
  } catch (error) {
    if (error instanceof StoreError) return blocked(error.code,
      preflightMessage(error.code, error.message));
    throw error;
  }
}

function preflightMessage(code: string, fallback: string): string {
  const messages: Readonly<Record<string, string>> = {
    BRIEF_REQUIRED: '请先建立 Production Brief',
    MANIFEST_REQUIRED: '请先批准参考资产并冻结当前资产清单',
    MODE_BLOCKED: '当前 Production Mode 已停用，请选择可用 Mode',
    MODE_CAPABILITY_MISMATCH: '当前 Mode 不支持该镜头所需的生成方式',
    BINDING_MISSING_INPUT: '镜头缺少已批准并进入资产清单的参考输入',
    BINDING_INVALID_COMBINATION: '镜头参考输入的组合不符合 H3 规则',
    BINDING_KIND_MISMATCH: '参考资产类型与镜头输入槽不匹配',
  };
  return messages[code] ?? fallback;
}

function isWorkerMode(mode: string): boolean {
  return mode === 'i2v' || mode === 'fl2v' || mode === 'r2v';
}

const purposeRole = {
  first_frame: 'first_frame', last_frame: 'last_frame',
  reference_character: 'character', reference_prop: 'product',
  reference_composition: 'scene', reference_style: 'style',
  reference_stage: 'scene', reference_target_state: 'last_frame',
} as const;

function blocked(code: string, message: string): GenerationPreflight {
  return { ready: false, blocking_error: { code, message }, mode: null,
    input_bindings: [], gate_override_required: false };
}

function decode(value: string, name: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded) throw new Error('empty');
    return decoded;
  } catch {
    throw new ApiError(400, 'ROUTE_PARAMETER_INVALID', `${name} is invalid`);
  }
}
