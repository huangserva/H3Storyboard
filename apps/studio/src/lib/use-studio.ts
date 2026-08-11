import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CreateProjectInput,
  CreateShotPlanInput,
  Project,
  ProjectSnapshot,
  UpdateShotPlanInput,
} from '@h3storyboard/protocol';
import * as api from './api.js';

export interface Notice {
  tone: 'success' | 'error';
  text: string;
}

function describeError(error: unknown): string {
  if (error instanceof api.ApiError) {
    return `${error.message} · ${error.code}`;
  }
  return error instanceof Error ? error.message : '发生未知错误';
}

export function useStudio() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const selectionRequest = useRef(0);

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await api.listProjects());
    } catch (error) {
      setNotice({ tone: 'error', text: describeError(error) });
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  const selectProject = useCallback(async (projectId: string) => {
    const requestId = selectionRequest.current + 1;
    selectionRequest.current = requestId;
    setBusy(true);
    try {
      const next = await api.getProject(projectId);
      if (requestId !== selectionRequest.current) return;
      setSnapshot(next);
      setSelectedShotId(next.shot_plans[0]?.id ?? null);
    } catch (error) {
      setNotice({ tone: 'error', text: describeError(error) });
    } finally {
      if (requestId === selectionRequest.current) setBusy(false);
    }
  }, []);

  const addProject = useCallback(
    async (input: CreateProjectInput) => {
      setBusy(true);
      try {
        const next = await api.createProject(input);
        setSnapshot(next);
        setSelectedShotId(null);
        await refreshProjects();
        setNotice({ tone: 'success', text: '项目已建立，脚本 V1 已锁定' });
        return true;
      } catch (error) {
        setNotice({ tone: 'error', text: describeError(error) });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refreshProjects],
  );

  const addShot = useCallback(
    async (input: CreateShotPlanInput) => {
      if (!snapshot) return false;
      setBusy(true);
      try {
        const next = await api.createShotPlan(snapshot.project.id, input);
        const newest = next.shot_plans.at(-1);
        setSnapshot(next);
        setSelectedShotId(newest?.id ?? null);
        setNotice({ tone: 'success', text: `计划镜头 ${newest?.title ?? ''} 已保存` });
        return true;
      } catch (error) {
        setNotice({ tone: 'error', text: describeError(error) });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [snapshot],
  );

  const updateShot = useCallback(async (input: UpdateShotPlanInput) => {
    setBusy(true);
    try {
      setSnapshot(await api.updateShotPlan(input));
      setNotice({ tone: 'success', text: '镜头语义输入与起止状态已保存' });
      return true;
    } catch (error) {
      setNotice({ tone: 'error', text: describeError(error) });
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const updateActual = useCallback(async (
    action: () => Promise<ProjectSnapshot['shot_actuals'][number]>,
    successText: string,
  ) => {
    setBusy(true);
    try {
      const actual = await action();
      setSnapshot((current) => current ? { ...current,
        shot_actuals: current.shot_actuals.map((item) =>
          item.id === actual.id ? actual : item) } : current);
      setNotice({ tone: 'success', text: successText });
      return true;
    } catch (error) {
      setNotice({ tone: 'error', text: describeError(error) });
      return false;
    } finally { setBusy(false); }
  }, []);

  const markRepresentative = useCallback((actualId: string,
    representative: boolean) => updateActual(
      () => api.markRepresentative(actualId, representative),
      representative ? '已标记代表 Take，等待导演批准' : '已撤销代表 Take',
    ), [updateActual]);

  const reviewRepresentative = useCallback((actualId: string,
    status: 'approved' | 'rejected') => updateActual(
      () => api.reviewRepresentative(actualId, status),
      status === 'approved' ? '代表 Take 已批准，批量门禁已打开' : '代表 Take 已拒绝',
    ), [updateActual]);

  return {
    projects,
    snapshot,
    selectedShotId,
    selectedShot: snapshot?.shot_plans.find((shot) => shot.id === selectedShotId) ?? null,
    busy,
    notice,
    selectProject,
    selectShot: setSelectedShotId,
    addProject,
    addShot,
    updateShot,
    markRepresentative,
    reviewRepresentative,
    dismissNotice: () => setNotice(null),
  };
}
