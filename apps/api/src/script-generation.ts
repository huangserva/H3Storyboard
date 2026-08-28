import {
  GenerateScriptInputSchema,
  ScriptGenerationCapabilitySchema,
  ScriptGenerationResultSchema,
  type GenerateScriptInput,
  type ScriptGenerationCapability,
  type ScriptGenerationResult,
} from '@h3storyboard/protocol';
import type { ProjectStore } from '@h3storyboard/project-store';
import { ApiError } from './api-error.js';
import {
  inspectQuality,
  parseGeneratedScript,
  parseGenerationReview,
} from './script-generation-contract.js';
import {
  createOpenAiScriptGenerationProvider,
  type ScriptGenerationConfig,
  type ScriptGenerationProvider,
} from './script-generation-provider.js';

export type { ScriptGenerationConfig } from './script-generation-provider.js';

const STRATEGY = 'shuohao_v1' as const;
const MAX_ATTEMPTS = 2;

export interface ScriptGenerationService {
  capability(): ScriptGenerationCapability;
  generate(store: ProjectStore, projectId: string,
    input: GenerateScriptInput): Promise<ScriptGenerationResult>;
}

export function createScriptGenerationService(
  rawConfig?: ScriptGenerationConfig,
): ScriptGenerationService {
  const provider = rawConfig
    ? createOpenAiScriptGenerationProvider(rawConfig) : null;
  const activeProjects = new Set<string>();
  return {
    capability: () => capability(provider),
    async generate(store, projectId, rawInput) {
      if (!provider) throw new ApiError(503, 'SCRIPT_GENERATION_UNAVAILABLE',
        'AI script generation is not configured on this server');
      const input = GenerateScriptInputSchema.parse(rawInput);
      if (activeProjects.has(projectId)) throw new ApiError(
        409,
        'SCRIPT_GENERATION_ACTIVE',
        'An AI script generation is already active for this project',
      );
      activeProjects.add(projectId);
      try {
        return await generateDraft(store, projectId, input, provider);
      } finally {
        activeProjects.delete(projectId);
      }
    },
  };
}

function capability(provider: ScriptGenerationProvider | null):
ScriptGenerationCapability {
  return ScriptGenerationCapabilitySchema.parse(provider ? {
    available: true,
    strategy: STRATEGY,
    provider: provider.provider,
    model: provider.model,
  } : {
    available: false,
    strategy: STRATEGY,
    provider: null,
    model: null,
  });
}

async function generateDraft(store: ProjectStore, projectId: string,
  input: GenerateScriptInput, provider: ScriptGenerationProvider):
Promise<ScriptGenerationResult> {
  const versions = store.scripts.listVersions(projectId);
  if (versions.some(({ status }) => status === 'draft')) throw new ApiError(
    409,
    'SCRIPT_DRAFT_EXISTS',
    'Finish or replace the existing editable script draft first',
  );
  let previousResponse = '';
  let feedback: readonly string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const content = await provider.generate(
      input,
      attempt,
      previousResponse,
      feedback,
    );
    const parsed = parseGeneratedScript(content);
    if (parsed.success) {
      const qualityIssues = inspectQuality(parsed.data, input);
      if (qualityIssues.length === 0) {
        const reviewResponse = await provider.review(input, parsed.data);
        const reviewDecision = parseGenerationReview(reviewResponse);
        if (!reviewDecision.success) throw new ApiError(
          502,
          'SCRIPT_GENERATION_REVIEW_INVALID',
          'The independent reviewer did not return a valid verdict',
          { issues: reviewDecision.issues },
        );
        const decision = reviewDecision.data;
        if (decision.verdict === 'revise') throw new ApiError(
          422,
          'SCRIPT_GENERATION_REVIEW_REJECTED',
          'The independent reviewer found blocking story issues',
          decision,
        );
        const review = {
          verdict: decision.verdict === 'approve'
            ? 'approve' as const : 'approve_with_notes' as const,
          summary: decision.summary,
          findings: decision.findings,
          provider: provider.provider,
          model: provider.model,
          review_method: 'fresh_context' as const,
          reviewed_revision: 0,
        };
        const document = store.scripts.importGenerated(projectId, {
          format: 'shuohao_novel_script',
          title: input.title,
          content: JSON.stringify(parsed.data),
        }, parsed.data, {
          provider: provider.provider,
          model: provider.model,
          review,
          input,
        });
        return ScriptGenerationResultSchema.parse({
          document,
          validation: store.scripts.validate(projectId, document.version.id),
          generation: {
            strategy: STRATEGY,
            provider: provider.provider,
            model: provider.model,
            attempt_count: attempt,
            review,
          },
        });
      }
      previousResponse = JSON.stringify(parsed.data);
      feedback = qualityIssues;
    } else {
      previousResponse = content;
      feedback = parsed.issues;
    }
  }
  throw new ApiError(502, 'SCRIPT_GENERATION_RESPONSE_INVALID',
    'The AI provider did not return a valid Shuohao script after repair', {
      issues: feedback,
      attempt_count: MAX_ATTEMPTS,
    });
}
