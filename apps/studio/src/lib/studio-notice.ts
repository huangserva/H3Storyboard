import * as api from './api.js';

export interface Notice {
  tone: 'success' | 'error';
  text: string;
}

export function describeError(error: unknown): string {
  if (error instanceof api.ApiError) {
    const message = ({
      LOCK_REQUIRED: '请先完成 Production Brief 并锁定生成上下文',
      MANIFEST_REQUIRED: '请先批准参考资产并冻结当前资产清单',
      MODE_BLOCKED: '当前 Production Mode 已停用',
      H3_MODE_UNAVAILABLE: '本机 worker 暂不支持该生成方式',
      TAKE_GATE_BLOCKED: '请先批准代表 Take，或填写门禁跳过原因',
      BINDING_MISSING_INPUT: '镜头缺少可用的参考输入',
      MODE_CAPABILITY_MISMATCH: '当前 Mode 不支持该镜头的生成方式',
    } satisfies Readonly<Record<string, string>>)[error.code] ?? error.message;
    return `${message} · ${error.code}`;
  }
  return error instanceof Error ? error.message : '发生未知错误';
}
