export type CanvasDemoErrorCode =
  | 'CANVAS_DEMO_AUDIO_FORBIDDEN'
  | 'CANVAS_DEMO_DB_NOT_ISOLATED'
  | 'CANVAS_DEMO_DUPLICATE_PROJECTS'
  | 'CANVAS_DEMO_LINEAGE_INCOMPLETE'
  | 'CANVAS_DEMO_MEDIA_PATH_INVALID'
  | 'CANVAS_DEMO_VIDEO_TRACK_MISSING';

export class CanvasDemoError extends Error {
  readonly code: CanvasDemoErrorCode;

  constructor(code: CanvasDemoErrorCode, message: string) {
    super(message);
    this.name = 'CanvasDemoError';
    this.code = code;
  }
}
