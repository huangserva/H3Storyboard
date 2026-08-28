import {
  CompileScriptInputSchema,
  GenerateScriptInputSchema,
  ImportScriptInputSchema,
  LockScriptInputSchema,
  ScriptCompilationResultSchema,
  ScriptDocumentSchema,
  ScriptGenerationCapabilitySchema,
  ScriptGenerationResultSchema,
  ScriptValidationSchema,
  ScriptVersionSchema,
  UpdateScriptDocumentInputSchema,
} from '@h3storyboard/protocol';
import type { ProjectStore } from '@h3storyboard/project-store';
import type { IncomingMessage } from 'node:http';
import { ApiError, parseResponseContract } from './api-error.js';
import { readJson } from './http.js';
import type { ScriptGenerationService } from './script-generation.js';

interface ScriptRouteResult { status: number; body: unknown }

const SCRIPT_LIST = /^\/api\/projects\/([^/]+)\/scripts$/;
const SCRIPT_IMPORT = /^\/api\/projects\/([^/]+)\/scripts\/import$/;
const SCRIPT_GENERATION = /^\/api\/projects\/([^/]+)\/scripts\/generation$/;
const SCRIPT_ACTION = /^\/api\/projects\/([^/]+)\/scripts\/([^/]+)\/(validate|lock|compile)$/;
const SCRIPT_DOCUMENT = /^\/api\/projects\/([^/]+)\/scripts\/([^/]+)$/;

export async function dispatchScriptRoute(request: IncomingMessage,
  store: ProjectStore, generation: ScriptGenerationService, method: string,
  pathname: string): Promise<ScriptRouteResult | null> {
  const list = SCRIPT_LIST.exec(pathname);
  if (list && method === 'GET') {
    const projectId = decode(list[1] ?? '', 'project_id');
    return { status: 200, body: store.scripts.listVersions(projectId)
      .map((version) => parseResponseContract(ScriptVersionSchema, version)) };
  }
  const imported = SCRIPT_IMPORT.exec(pathname);
  if (imported && method === 'POST') {
    const projectId = decode(imported[1] ?? '', 'project_id');
    const input = ImportScriptInputSchema.parse(await readJson(request));
    return { status: 201, body: parseResponseContract(ScriptDocumentSchema,
      store.scripts.import(projectId, input)) };
  }
  const generated = SCRIPT_GENERATION.exec(pathname);
  if (generated) {
    const projectId = decode(generated[1] ?? '', 'project_id');
    store.scripts.listVersions(projectId);
    if (method === 'GET') return { status: 200, body: parseResponseContract(
      ScriptGenerationCapabilitySchema, generation.capability()) };
    if (method === 'POST') {
      const input = GenerateScriptInputSchema.parse(await readJson(request));
      return { status: 201, body: parseResponseContract(
        ScriptGenerationResultSchema,
        await generation.generate(store, projectId, input)) };
    }
    return null;
  }
  const action = SCRIPT_ACTION.exec(pathname);
  if (action && method === 'POST') {
    const projectId = decode(action[1] ?? '', 'project_id');
    const scriptId = decode(action[2] ?? '', 'script_version_id');
    const name = action[3];
    if (name === 'validate') return { status: 200,
      body: parseResponseContract(ScriptValidationSchema,
        store.scripts.validate(projectId, scriptId)) };
    if (name === 'lock') {
      const input = LockScriptInputSchema.parse(await readJson(request));
      return { status: 200,
        body: parseResponseContract(ScriptDocumentSchema,
          store.scripts.lock(projectId, scriptId, input)) };
    }
    const input = CompileScriptInputSchema.parse(await readJson(request));
    return { status: 201, body: parseResponseContract(
      ScriptCompilationResultSchema,
      store.scripts.compile(projectId, scriptId, input)) };
  }
  const document = SCRIPT_DOCUMENT.exec(pathname);
  if (!document) return null;
  const projectId = decode(document[1] ?? '', 'project_id');
  const scriptId = decode(document[2] ?? '', 'script_version_id');
  if (method === 'GET') return { status: 200,
    body: parseResponseContract(ScriptDocumentSchema,
      store.scripts.getDocument(projectId, scriptId)) };
  if (method === 'PUT') {
    const input = UpdateScriptDocumentInputSchema.parse(await readJson(request));
    return { status: 200, body: parseResponseContract(ScriptDocumentSchema,
      store.scripts.update(projectId, scriptId, input)) };
  }
  return null;
}

function decode(value: string, name: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded) throw new Error('empty');
    return decoded;
  } catch {
    throw new ApiError(400, 'ROUTE_PARAMETER_INVALID', `${name} is invalid`);
  }
}
