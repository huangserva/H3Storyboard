import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import type { BindShotReferenceInput,
  GenerationPreflight, ProjectSnapshot, ShotPlan } from
  '@h3storyboard/protocol';
import * as api from './api.js';
import { generationInput, H3BatchAttemptCache } from
  './generation-attempt-cache.js';
import { describeError, type Notice } from './studio-notice.js';

interface GenerationActionsInput {
  snapshot: ProjectSnapshot | null;
  setSnapshot: Dispatch<SetStateAction<ProjectSnapshot | null>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setNotice: Dispatch<SetStateAction<Notice | null>>;
}

export function useGenerationActions({ snapshot, setSnapshot, setBusy,
  setNotice }: GenerationActionsInput) {
  const batchAttempts = useRef(new H3BatchAttemptCache());
  const generate = useCallback(async (shot: ShotPlan,
    preflight: GenerationPreflight, gateOverrideReason: string | null) => {
    if (!snapshot || !preflight.ready || !preflight.mode) return false;
    setBusy(true);
    try {
      await api.createH3Job(snapshot.project.id, shot.id,
        generationInput(shot, preflight, gateOverrideReason));
      setSnapshot(await api.getProject(snapshot.project.id));
      setNotice({ tone: 'success', text: '生成任务已入队，可在分镜卡片查看进度' });
      return true;
    } catch (error) {
      setNotice({ tone: 'error', text: describeError(error) });
      return false;
    } finally { setBusy(false); }
  }, [setBusy, setNotice, setSnapshot, snapshot]);

  const generateBatch = useCallback(async (shots: ShotPlan[],
    preflights: Map<string, GenerationPreflight>,
    gateOverrideReason: string | null) => {
    if (!snapshot || shots.length === 0) return false;
    if (shots.some((shot) => !preflights.get(shot.id)?.ready ||
      !preflights.get(shot.id)?.mode)) return false;
    const attempt = batchAttempts.current.prepare(
      shots, preflights, gateOverrideReason);
    setBusy(true);
    try {
      await api.createH3JobBatch(snapshot.project.id, attempt.input);
      setSnapshot(await api.getProject(snapshot.project.id));
      batchAttempts.current.complete(attempt.key);
      setNotice({ tone: 'success',
        text: `${shots.length} 个 H3 任务已原子入队` });
      return true;
    } catch (error) {
      setNotice({ tone: 'error', text: describeError(error) });
      return false;
    } finally { setBusy(false); }
  }, [setBusy, setNotice, setSnapshot, snapshot]);

  const bindReference = useCallback(async (shotId: string,
    input: BindShotReferenceInput) => {
    if (!snapshot) return false;
    setBusy(true);
    try {
      const projectId = snapshot.project.id;
      await api.bindShotReference(projectId, shotId, input);
      const next = await api.getProject(projectId);
      setSnapshot((current) => current?.project.id === projectId ? next : current);
      setNotice({ tone: 'success', text: input.binding_type === 'continuity'
        ? 'Take 边界已写入镜头连续性' : '参考输入已绑定到计划镜头' });
      return true;
    } catch (error) {
      setNotice({ tone: 'error', text: describeError(error) });
      return false;
    } finally { setBusy(false); }
  }, [setBusy, setNotice, setSnapshot, snapshot]);

  return { generate, generateBatch, bindReference };
}
