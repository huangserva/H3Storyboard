import type {
  AssetKind,
  AssetRole,
  H3Mode,
  H3ProviderName,
} from '@h3storyboard/protocol';

export interface ProviderAsset {
  asset_id: string;
  kind: AssetKind;
  role: AssetRole;
  ordinal: number;
  content_hash: string;
  resolved_uri: string;
}

export interface ProviderSubmission {
  job_id: string;
  idempotency_key: string;
  mode: H3Mode;
  model: string;
  prompt: string;
  duration_seconds: number;
  seed: number | null;
  steps: number;
  assets: ProviderAsset[];
}

export type ProviderJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface ProviderJobResult {
  provider_job_id: string;
  status: ProviderJobStatus;
  output_uri: string | null;
  error_code: string | null;
  error_message: string | null;
}

export interface ProviderCapabilities {
  modes: readonly H3Mode[];
  max_images: number;
  max_videos: number;
  max_audio: number;
  max_total_assets: number;
}

export interface H3ProviderAdapter {
  readonly name: H3ProviderName;
  readonly capabilities: ProviderCapabilities;
  submit(submission: ProviderSubmission): Promise<ProviderJobResult>;
  query(providerJobId: string): Promise<ProviderJobResult>;
  cancel(providerJobId: string): Promise<ProviderJobResult>;
}

export type ProviderErrorCode =
  | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_REJECTED_INPUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_PROTOCOL_ERROR';

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProviderError';
  }
}
