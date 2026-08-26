import {
  ApprovePlanReviewInputSchema,
  PlanReviewSchema,
  UpdateDraftShotPlanInputSchema,
} from '@h3storyboard/protocol';
import type { ProjectStore } from '@h3storyboard/project-store';
import type { IncomingMessage } from 'node:http';
import { ApiError, parseResponseContract } from './api-error.js';
import { readJson } from './http.js';

interface PlanReviewRouteResult { status: number; body: unknown }

const REVIEW = /^\/api\/projects\/([^/]+)\/scripts\/([^/]+)\/plan_review$/;
const REVIEW_SHOT = /^\/api\/projects\/([^/]+)\/scripts\/([^/]+)\/plan_review\/shots\/([^/]+)$/;
const REVIEW_APPROVE = /^\/api\/projects\/([^/]+)\/scripts\/([^/]+)\/plan_review\/approve$/;

export async function dispatchPlanReviewRoute(request: IncomingMessage,
  store: ProjectStore, method: string,
  pathname: string): Promise<PlanReviewRouteResult | null> {
  const review = REVIEW.exec(pathname);
  if (review && method === 'GET') {
    return { status: 200, body: parseResponseContract(PlanReviewSchema,
      store.planReviews.get(decode(review[1]), decode(review[2]))) };
  }
  const shot = REVIEW_SHOT.exec(pathname);
  if (shot && method === 'PATCH') {
    const input = UpdateDraftShotPlanInputSchema.parse(await readJson(request));
    return { status: 200, body: parseResponseContract(PlanReviewSchema,
      store.planReviews.updateShot(decode(shot[1]), decode(shot[2]),
        decode(shot[3]), input)) };
  }
  const approve = REVIEW_APPROVE.exec(pathname);
  if (approve && method === 'POST') {
    const input = ApprovePlanReviewInputSchema.parse(await readJson(request));
    return { status: 200, body: parseResponseContract(PlanReviewSchema,
      store.planReviews.approve(decode(approve[1]), decode(approve[2]), input)) };
  }
  return null;
}

function decode(value: string | undefined): string {
  try {
    const decoded = decodeURIComponent(value ?? '');
    if (!decoded) throw new Error('empty');
    return decoded;
  } catch {
    throw new ApiError(400, 'ROUTE_PARAMETER_INVALID',
      'Plan review route parameter is invalid');
  }
}
