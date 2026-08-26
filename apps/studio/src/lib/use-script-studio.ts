import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ImportScriptInput,
  ScriptDocument,
  ScriptValidation,
  ScriptVersion,
  UpdateScriptDocumentInput,
} from '@h3storyboard/protocol';
import * as scriptApi from './script-api.js';
import { describeError } from './studio-notice.js';

export function useScriptStudio(projectId: string) {
  const projectRef = useRef(projectId);
  const loadSequence = useRef(0);
  projectRef.current = projectId;
  const [versions, setVersions] = useState<ScriptVersion[]>([]);
  const [document, setDocument] = useState<ScriptDocument | null>(null);
  const [validation, setValidation] = useState<ScriptValidation | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setBusy(true);
    try {
      const nextVersions = await scriptApi.listScriptVersions(projectId);
      if (sequence !== loadSequence.current || projectRef.current !== projectId) return;
      setVersions(nextVersions);
      const current = nextVersions.find(({ status }) => status === 'draft')
        ?? nextVersions.find(({ status }) => status === 'locked') ?? null;
      const nextDocument = current
        ? await scriptApi.getScriptDocument(projectId, current.id) : null;
      if (sequence !== loadSequence.current || projectRef.current !== projectId) return;
      setDocument(nextDocument);
      setValidation(null);
    } catch (error) {
      if (sequence === loadSequence.current && projectRef.current === projectId) {
        setMessage(describeError(error));
      }
    }
    finally {
      if (sequence === loadSequence.current && projectRef.current === projectId) {
        setBusy(false);
      }
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const run = useCallback(async <T,>(operation: () => Promise<T>,
    success: string): Promise<T | null> => {
    const operationProject = projectId;
    setBusy(true); setMessage(null);
    try {
      const result = await operation();
      if (projectRef.current !== operationProject) return null;
      setMessage(success);
      return result;
    } catch (error) {
      if (projectRef.current === operationProject) setMessage(describeError(error));
      return null;
    } finally {
      if (projectRef.current === operationProject) setBusy(false);
    }
  }, [projectId]);

  const importDraft = async (input: ImportScriptInput) => {
    const result = await run(() => scriptApi.importScript(projectId, input),
      '剧本已导入为可编辑草稿');
    if (result) { setDocument(result); await load(); }
    return result;
  };
  const selectVersion = async (scriptVersionId: string) => {
    const result = await run(() => scriptApi.getScriptDocument(
      projectId, scriptVersionId), '剧本版本已载入');
    if (result) { setDocument(result); setValidation(null); }
    return result;
  };
  const save = async (input: UpdateScriptDocumentInput) => {
    if (!document) return null;
    const result = await run(() => scriptApi.updateScript(
      projectId, document.version.id, input), '剧本草稿已保存');
    if (result) { setDocument(result); setValidation(null); }
    return result;
  };
  const validate = async () => {
    if (!document) return null;
    const result = await run(() => scriptApi.validateScript(
      projectId, document.version.id), '确定性剧本校验完成');
    if (result) setValidation(result);
    return result;
  };
  const lock = async (expectedRevision?: number) => {
    if (!document) return null;
    const result = await run(() => scriptApi.lockScript(
      projectId, document.version.id, {
        expected_revision: expectedRevision ?? document.version.revision,
      }), '剧本版本已锁定');
    if (result) { setDocument(result); await load(); }
    return result;
  };
  const compile = async () => {
    if (!document) return null;
    return run(() => scriptApi.compileScript(projectId, document.version.id, {
      idempotency_key: `script-compile-${document.version.id}`,
    }), '草稿分镜已生成并进入画布');
  };

  return { versions, document, setDocument, validation, busy, message,
    importDraft, selectVersion, save, validate, lock, compile };
}
