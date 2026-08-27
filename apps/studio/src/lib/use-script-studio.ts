import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ImportScriptInput,
  PlanReview,
  ScriptDocument,
  ScriptValidation,
  ScriptVersion,
  UpdateScriptDocumentInput,
  UpdateDraftShotPlanInput,
} from '@h3storyboard/protocol';
import * as scriptApi from './script-api.js';
import { ApiError } from './api.js';
import { describeError } from './studio-notice.js';

export function useScriptStudio(projectId: string) {
  const projectRef = useRef(projectId);
  const loadSequence = useRef(0);
  projectRef.current = projectId;
  const [versions, setVersions] = useState<ScriptVersion[]>([]);
  const [document, setDocument] = useState<ScriptDocument | null>(null);
  const [validation, setValidation] = useState<ScriptValidation | null>(null);
  const [review, setReview] = useState<PlanReview | null>(null);
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
      const nextReview = current
        ? await optionalReview(projectId, current.id) : null;
      if (sequence !== loadSequence.current || projectRef.current !== projectId) return;
      setDocument(nextDocument);
      setReview(nextReview);
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

  useEffect(() => {
    loadSequence.current += 1;
    setVersions([]);
    setDocument(null);
    setValidation(null);
    setReview(null);
    setMessage(null);
    void load();
  }, [load]);

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
    if (result) { setDocument(result); setReview(null); await load(); }
    return result;
  };
  const selectVersion = async (scriptVersionId: string) => {
    const result = await run(async () => ({
      document: await scriptApi.getScriptDocument(projectId, scriptVersionId),
      review: await optionalReview(projectId, scriptVersionId),
    }), '剧本版本已载入');
    if (result) {
      setDocument(result.document); setValidation(null);
      setReview(result.review);
    }
    return result?.document ?? null;
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
    if (result) { setDocument(result); setReview(null); await load(); }
    return result;
  };
  const compile = async () => {
    if (!document) return null;
    const scriptVersionId = document.version.id;
    const result = await run(async () => ({
      compilation: await scriptApi.compileScript(
        projectId, scriptVersionId, {
          idempotency_key: `script-compile-${scriptVersionId}`,
        }),
      review: await scriptApi.getPlanReview(projectId, scriptVersionId),
    }), '草稿分镜已生成，等待逐镜审核');
    if (result) setReview(result.review);
    return result?.compilation ?? null;
  };
  const updateReviewShot = async (shotPlanId: string,
    input: UpdateDraftShotPlanInput) => {
    if (!document) return null;
    const result = await run(() => scriptApi.updateDraftShotPlan(
      projectId, document.version.id, shotPlanId, input), '导演修改已保存');
    if (result) setReview(result);
    return result;
  };
  const approveReview = async () => {
    if (!document || !review) return null;
    const result = await run(() => scriptApi.approvePlanReview(
      projectId, document.version.id, {
        expected_revision: review.compilation.revision,
      }), '整套分镜已批准为当前执行计划');
    if (result) setReview(result);
    return result;
  };

  return { versions, document, setDocument, validation, review, busy, message,
    importDraft, selectVersion, save, validate, lock, compile,
    updateReviewShot, approveReview };
}

async function optionalReview(projectId: string,
  scriptVersionId: string): Promise<PlanReview | null> {
  try {
    return await scriptApi.getPlanReview(projectId, scriptVersionId);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'PLAN_REVIEW_NOT_FOUND') {
      return null;
    }
    throw error;
  }
}
