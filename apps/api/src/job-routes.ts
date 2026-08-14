import { CreateH3JobInputSchema, type GenerationPreflight,
  type ProjectSnapshot } from '@h3storyboard/protocol';
import { StoreError, type ProjectStore } from '@h3storyboard/project-store';
import type { IncomingMessage } from 'node:http';
import { ApiError } from './api-error.js';
import { readJson } from './http.js';

interface JobRouteResult { status: number; body: unknown }

const JOBS = /^\/api\/projects\/([^/]+)\/shots\/([^/]+)\/jobs$/;
const PREFLIGHT = /^\/api\/projects\/([^/]+)\/shots\/([^/]+)\/jobs\/preflight$/;

export async function dispatchJobRoute(request: IncomingMessage,
  store: ProjectStore, method: string,
  pathname: string): Promise<JobRouteResult | null> {
  const preflight = PREFLIGHT.exec(pathname);
  if (preflight && method === 'GET') {
    const { projectId, shotId, snapshot } = scopedShot(
      store, preflight[1] ?? '', preflight[2] ?? '');
    return { status: 200, body: generationPreflight(
      store, projectId, shotId, snapshot) };
  }
  const jobs = JOBS.exec(pathname);
  if (!jobs || method !== 'POST') return null;
  const { shotId } = scopedShot(store, jobs[1] ?? '', jobs[2] ?? '');
  const parsed = CreateH3JobInputSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(422, 'H3_BINDINGS_INVALID',
    'H3 job input does not satisfy the provider contract', parsed.error.issues);
  const readiness = generationPreflight(store, decode(jobs[1] ?? '', 'project_id'),
    shotId, store.getProjectSnapshot(decode(jobs[1] ?? '', 'project_id')));
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

function generationPreflight(store: ProjectStore, projectId: string,
  shotId: string, snapshot: ProjectSnapshot): GenerationPreflight {
  const lock = store.production.getLock(projectId);
  const briefs = store.production.listBriefs(projectId);
  if (!lock.engaged) return blocked('LOCK_REQUIRED',
    briefs.length === 0
      ? '请先建立 Production Brief 并锁定生成上下文'
      : '请先锁定 Production Brief 与当前资产清单');
  try {
    const compiled = store.production.compileBindings(shotId);
    if (!isWorkerMode(compiled.generation_mode)) return blocked(
      'H3_MODE_UNAVAILABLE',
      `本机常驻 worker 尚不支持 ${compiled.generation_mode}，请调整 Production Mode`);
    const jobs = snapshot.h3_jobs.filter(({ shot_plan_id }) => shot_plan_id === shotId);
    const approvedRepresentative = snapshot.shot_actuals.some((actual) =>
      actual.shot_plan_id === shotId && actual.is_representative &&
      actual.representative_status === 'approved');
    return { ready: true, blocking_error: null,
      mode: compiled.generation_mode, input_bindings: compiled.bindings.map(
        ({ asset_id, purpose }, ordinal) => {
          const asset = snapshot.assets.find(({ id }) => id === asset_id)!;
          return { asset_id, asset_kind: asset.kind,
            role: purposeRole[purpose], ordinal };
        }),
      gate_override_required: jobs.length > 0 && !approvedRepresentative };
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
