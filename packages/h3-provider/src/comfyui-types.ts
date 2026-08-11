export type ComfyGraph = Record<string, ComfyNode>;

export interface ComfyNode {
  class_type: string;
  inputs: Record<string, unknown>;
}

export type H3ComfyErrorCode =
  | 'H3_DIMENSION_INVALID'
  | 'H3_FRAME_GRID_INVALID'
  | 'H3_PROMPT_CN_AUDIO'
  | 'H3_COMFY_HTTP_ERROR'
  | 'H3_COMFY_PROTOCOL_ERROR'
  | 'H3_COMFY_TIMEOUT'
  | 'H3_COMFY_OUTPUT_MISSING'
  | 'H3_COMFY_EMPTY_DOWNLOAD';

export class H3ComfyError extends Error {
  constructor(readonly code: H3ComfyErrorCode, message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions) {
    super(message, options);
    this.name = 'H3ComfyError';
  }
}

export interface ComfyOutputItem {
  filename: string;
  subfolder?: string;
  type?: string;
}

export interface ComfyHistoryEntry {
  status?: {
    completed?: boolean;
    status_str?: string;
    messages?: unknown[];
  };
  outputs?: Record<string, Record<string, unknown>>;
}
