export type StoreErrorCode =
  | 'SCHEMA_VERSION_UNSUPPORTED'
  | 'DATABASE_RECORD_INVALID'
  | 'INPUT_INVALID'
  | 'PROJECT_NOT_FOUND'
  | 'SCRIPT_VERSION_NOT_FOUND'
  | 'SCRIPT_NOT_LOCKED'
  | 'SHOT_PLAN_NOT_FOUND'
  | 'SHOT_ACTUAL_NOT_FOUND'
  | 'SHOT_ACTUAL_CONFLICT'
  | 'CONTINUITY_DEPENDENCY_INVALID'
  | 'ASSET_NOT_FOUND'
  | 'ASSET_PROJECT_MISMATCH'
  | 'ASSET_KIND_MISMATCH'
  | 'ASSET_DERIVATION_INVALID'
  | 'H3_BINDINGS_INVALID'
  | 'H3_JOB_NOT_FOUND'
  | 'H3_JOB_SHOT_MISMATCH'
  | 'H3_JOB_NOT_COMPLETED'
  | 'H3_JOB_OUTPUT_MISMATCH'
  | 'H3_JOB_STATUS_INVALID'
  | 'H3_JOB_LEASE_INVALID'
  | 'H3_JOB_LEASE_EXPIRED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'OUTPUT_ASSET_KIND_INVALID'
  | 'OUTPUT_ASSET_ALREADY_CLAIMED'
  | 'QC_VERDICT_INVALID';

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  readonly details: unknown;

  constructor(code: StoreErrorCode, message: string, details: unknown = null) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
    this.details = details;
  }
}
