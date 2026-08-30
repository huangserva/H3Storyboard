import type {
  GenerateScriptInput,
  GeneratedShuohaoScript,
} from '@h3storyboard/protocol';
import { z } from 'zod';
import { ApiError } from './api-error.js';
import {
  generationPrompt,
  repairPrompt,
  reviewPrompt,
  REVIEW_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
} from './script-generation-contract.js';
import {
  postJsonWithLimit,
  ProviderResponseTooLargeError,
} from './script-generation-http.js';

const MAX_PROVIDER_BODY_BYTES = 1_000_000;

export class ScriptGenerationConfigError extends Error {
  constructor(readonly code: 'INVALID_ENDPOINT' | 'INVALID_MODEL' |
  'INVALID_TIMEOUT', message: string) {
    super(message);
    this.name = 'ScriptGenerationConfigError';
  }
}

export interface ScriptGenerationConfig {
  endpoint: string;
  api_key?: string;
  model: string;
  provider?: string;
  timeout_ms?: number;
}

export interface ScriptGenerationProvider {
  readonly provider: string;
  readonly model: string;
  generate(input: GenerateScriptInput, attempt: number,
    previousResponse: string, feedback: readonly string[]): Promise<string>;
  review(input: GenerateScriptInput,
    script: GeneratedShuohaoScript): Promise<string>;
}

interface NormalizedConfig {
  endpoint: string;
  api_key: string | null;
  model: string;
  provider: string;
  timeout_ms: number;
}

export function createOpenAiScriptGenerationProvider(
  rawConfig: ScriptGenerationConfig,
): ScriptGenerationProvider {
  const config = normalizeConfig(rawConfig);
  return {
    provider: config.provider,
    model: config.model,
    generate: (input, attempt, previousResponse, feedback) => callProvider(
      config,
      input,
      attempt,
      previousResponse,
      feedback,
    ),
    review: (input, script) => callCompletion(config, 0.1, [
      { role: 'system', content: REVIEW_SYSTEM_PROMPT },
      { role: 'user', content: reviewPrompt(input, script) },
    ]),
  };
}

function normalizeConfig(raw: ScriptGenerationConfig): NormalizedConfig {
  let endpoint: URL;
  try { endpoint = new URL(raw.endpoint); }
  catch { throw new ScriptGenerationConfigError(
    'INVALID_ENDPOINT', 'H3_SCRIPT_AI_ENDPOINT must be a valid URL'); }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new ScriptGenerationConfigError(
      'INVALID_ENDPOINT', 'H3_SCRIPT_AI_ENDPOINT must use http or https');
  }
  const model = raw.model.trim();
  const provider = raw.provider?.trim() || 'openai-compatible';
  const timeout = raw.timeout_ms ?? 120_000;
  if (!model) throw new ScriptGenerationConfigError(
    'INVALID_MODEL', 'H3_SCRIPT_AI_MODEL must not be empty');
  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new ScriptGenerationConfigError(
      'INVALID_TIMEOUT', 'H3_SCRIPT_AI_TIMEOUT_MS must be a positive integer');
  }
  return {
    endpoint: raw.endpoint.replace(/\/+$/, ''),
    api_key: raw.api_key?.trim() || null,
    model,
    provider,
    timeout_ms: timeout,
  };
}

async function callProvider(config: NormalizedConfig,
  input: GenerateScriptInput, attempt: number, previousResponse: string,
  feedback: readonly string[]): Promise<string> {
  return callCompletion(config, attempt === 1 ? 0.7 : 0.2, [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: attempt === 1
      ? generationPrompt(input)
      : repairPrompt(input, previousResponse, feedback) },
  ]);
}

async function callCompletion(config: NormalizedConfig, temperature: number,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
): Promise<string> {
  const signal = AbortSignal.timeout(config.timeout_ms);
  let status: number;
  let text: string;
  try {
    const response = await postJsonWithLimit(
      `${config.endpoint}/chat/completions`, {
        model: config.model,
        temperature,
        max_tokens: 12_000,
        messages,
      }, {
        signal,
        max_body_bytes: MAX_PROVIDER_BODY_BYTES,
        ...(config.api_key
          ? { authorization: `Bearer ${config.api_key}` } : {}),
      });
    status = response.status;
    text = response.body;
  } catch (error) {
    if (error instanceof ProviderResponseTooLargeError) throw responseTooLarge();
    if (signal.aborted || isTimeoutError(error)) throw new ApiError(
      504,
      'SCRIPT_GENERATION_TIMEOUT',
      'The AI script provider timed out',
    );
    throw new ApiError(502, 'SCRIPT_GENERATION_PROVIDER_FAILED',
      'Could not reach the AI script provider');
  }
  if (status < 200 || status >= 300) throw new ApiError(502,
    'SCRIPT_GENERATION_PROVIDER_FAILED',
    'The AI script provider rejected the request', {
      provider_status: status,
    });
  const envelope = ProviderResponseSchema.safeParse(parseJson(text));
  if (!envelope.success) throw new ApiError(502,
    'SCRIPT_GENERATION_RESPONSE_INVALID',
    'The AI script provider response did not match chat completions', {
      issues: envelope.error.issues,
    });
  return envelope.data.choices[0]!.message.content;
}

function responseTooLarge(): ApiError {
  return new ApiError(
    502,
    'SCRIPT_GENERATION_RESPONSE_INVALID',
    'The AI script provider response exceeded 1 MB',
  );
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError');
}

const ProviderResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string().max(750_000) }),
  })).min(1),
});

function parseJson(value: string): unknown | null {
  try { return JSON.parse(value) as unknown; }
  catch { return null; }
}
