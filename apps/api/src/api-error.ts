import { ZodError } from 'zod';
import { StoreError } from '@h3storyboard/project-store';

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const storeStatusByCode: Readonly<Record<string, number>> = {
  SCHEMA_VERSION_UNSUPPORTED: 500,
  DATABASE_RECORD_INVALID: 500,
  INPUT_INVALID: 400,
  PROJECT_NOT_FOUND: 404,
  SCRIPT_VERSION_NOT_FOUND: 404,
  SHOT_PLAN_NOT_FOUND: 404,
  ASSET_NOT_FOUND: 404,
  H3_JOB_NOT_FOUND: 404,
  SHOT_ACTUAL_NOT_FOUND: 404,
  SHOT_ACTUAL_CONFLICT: 409,
  CANVAS_NODE_NOT_FOUND: 404,
  CANVAS_NODE_CONFLICT: 409,
  CANVAS_NODE_REF_PROJECT_MISMATCH: 422,
  CHARACTER_NOT_FOUND: 404,
  CHARACTER_ARCHIVED: 409,
  CHARACTER_REFERENCE_NOT_FOUND: 404,
  CHARACTER_REFERENCE_DERIVATION_INVALID: 422,
  CHARACTER_REFERENCE_PROJECT_MISMATCH: 422,
  SCRIPT_NOT_LOCKED: 409,
  CONTINUITY_DEPENDENCY_INVALID: 422,
  H3_BINDINGS_INVALID: 422,
  ASSET_PROJECT_MISMATCH: 422,
  ASSET_KIND_MISMATCH: 422,
  ASSET_DERIVATION_INVALID: 422,
  ASSET_REPLACEMENT_INVALID: 422,
  ASSET_STATUS_INVALID: 409,
  ASSET_ARCHIVED: 409,
  ASSET_IMMUTABLE: 409,
  MANIFEST_EMPTY: 409,
  MANIFEST_NOT_FOUND: 404,
  MODE_NOT_FOUND: 404,
  MODE_KEY_CONFLICT: 409,
  MODE_TRANSITION_INVALID: 409,
  MODE_EVIDENCE_REQUIRED: 422,
  BRIEF_REQUIRED: 409,
  BRIEF_MODE_NOT_FOUND: 422,
  LOCK_REQUIRED: 409,
  LOCK_ENGAGED: 409,
  LOCK_ALREADY_ENGAGED: 409,
  LOCK_NOT_ENGAGED: 409,
  MANIFEST_REQUIRED: 409,
  BINDING_MISSING_INPUT: 422,
  BINDING_UNRELATED_INPUT: 422,
  MODE_CAPABILITY_MISMATCH: 422,
  H3_JOB_SHOT_MISMATCH: 422,
  H3_JOB_NOT_COMPLETED: 409,
  H3_JOB_OUTPUT_MISMATCH: 422,
  H3_JOB_STATUS_INVALID: 409,
  H3_JOB_LEASE_INVALID: 409,
  H3_JOB_LEASE_EXPIRED: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  OUTPUT_ASSET_KIND_INVALID: 422,
  OUTPUT_ASSET_ALREADY_CLAIMED: 409,
  QC_VERDICT_INVALID: 422,
};

export function errorResponse(error: unknown): {
  status: number;
  body: ErrorBody;
} {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: withDetails(error.code, error.message, error.details),
    };
  }

  if (error instanceof ZodError) {
    return {
      status: 400,
      body: withDetails(
        'VALIDATION_FAILED',
        'Request body did not match the API contract',
        error.issues,
      ),
    };
  }

  if (error instanceof StoreError) {
    return {
      status: storeStatusByCode[error.code] ?? 500,
      body: withDetails(error.code, error.message, error.details),
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The server could not complete the request',
      },
    },
  };
}

function withDetails(
  code: string,
  message: string,
  details: unknown,
): ErrorBody {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details } };
}
