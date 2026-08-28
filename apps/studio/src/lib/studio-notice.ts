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
      SCRIPT_GENERATION_UNAVAILABLE: 'AI 剧本模型尚未配置，请先配置模型或改用导入',
      SCRIPT_GENERATION_PROVIDER_FAILED: 'AI 剧本模型调用失败，请检查服务与凭据',
      SCRIPT_GENERATION_RESPONSE_INVALID: 'AI 返回的剧本未通过结构与质量门',
      SCRIPT_GENERATION_REVIEW_INVALID: '独立审阅没有返回有效结论，请重试',
      SCRIPT_GENERATION_REVIEW_REJECTED: '独立审阅发现阻断问题，未创建草稿',
      SCRIPT_GENERATION_TIMEOUT: 'AI 剧本生成超时，请稍后重试',
      SCRIPT_GENERATION_ACTIVE: '当前项目已有 AI 剧本正在生成，请等待完成',
      SCRIPT_DRAFT_EXISTS: '项目已有可编辑草稿，请先处理当前草稿',
    } satisfies Readonly<Record<string, string>>)[error.code] ?? error.message;
    return `${message} · ${error.code}`;
  }
  return error instanceof Error ? error.message : '发生未知错误';
}
