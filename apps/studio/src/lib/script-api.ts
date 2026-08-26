import type {
  CompileScriptInput,
  ImportScriptInput,
  LockScriptInput,
  ApprovePlanReviewInput,
  PlanReview,
  ScriptCompilationResult,
  ScriptDocument,
  ScriptValidation,
  ScriptVersion,
  UpdateScriptDocumentInput,
  UpdateDraftShotPlanInput,
} from '@h3storyboard/protocol';
import { request } from './api.js';

const root = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/scripts`;

export function listScriptVersions(projectId: string): Promise<ScriptVersion[]> {
  return request<ScriptVersion[]>(root(projectId));
}

export function getScriptDocument(projectId: string,
  scriptVersionId: string): Promise<ScriptDocument> {
  return request<ScriptDocument>(`${root(projectId)}/${scriptVersionId}`);
}

export function importScript(projectId: string,
  input: ImportScriptInput): Promise<ScriptDocument> {
  return request<ScriptDocument>(`${root(projectId)}/import`, {
    method: 'POST', body: JSON.stringify(input),
  });
}

export function updateScript(projectId: string, scriptVersionId: string,
  input: UpdateScriptDocumentInput): Promise<ScriptDocument> {
  return request<ScriptDocument>(`${root(projectId)}/${scriptVersionId}`, {
    method: 'PUT', body: JSON.stringify(input),
  });
}

export function validateScript(projectId: string,
  scriptVersionId: string): Promise<ScriptValidation> {
  return request<ScriptValidation>(
    `${root(projectId)}/${scriptVersionId}/validate`, {
      method: 'POST', body: '{}',
    });
}

export function lockScript(projectId: string,
  scriptVersionId: string, input: LockScriptInput): Promise<ScriptDocument> {
  return request<ScriptDocument>(`${root(projectId)}/${scriptVersionId}/lock`, {
    method: 'POST', body: JSON.stringify(input),
  });
}

export function compileScript(projectId: string, scriptVersionId: string,
  input: CompileScriptInput): Promise<ScriptCompilationResult> {
  return request<ScriptCompilationResult>(
    `${root(projectId)}/${scriptVersionId}/compile`, {
      method: 'POST', body: JSON.stringify(input),
    });
}

const reviewRoot = (projectId: string, scriptVersionId: string) =>
  `${root(projectId)}/${encodeURIComponent(scriptVersionId)}/plan_review`;

export function getPlanReview(projectId: string,
  scriptVersionId: string): Promise<PlanReview> {
  return request<PlanReview>(reviewRoot(projectId, scriptVersionId));
}

export function updateDraftShotPlan(projectId: string, scriptVersionId: string,
  shotPlanId: string, input: UpdateDraftShotPlanInput): Promise<PlanReview> {
  return request<PlanReview>(`${reviewRoot(projectId, scriptVersionId)}/shots/` +
    encodeURIComponent(shotPlanId), {
      method: 'PATCH', body: JSON.stringify(input),
    });
}

export function approvePlanReview(projectId: string, scriptVersionId: string,
  input: ApprovePlanReviewInput): Promise<PlanReview> {
  return request<PlanReview>(`${reviewRoot(projectId, scriptVersionId)}/approve`, {
    method: 'POST', body: JSON.stringify(input),
  });
}
