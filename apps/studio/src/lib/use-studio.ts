import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CreateProjectInput,
  CreateShotPlanInput,
  Project,
  ProjectSnapshot,
  UpdateShotPlanInput,
  GenerationPreflight,
  ShotPlan,
} from '@h3storyboard/protocol';
import * as api from './api.js';

export interface Notice {
  tone: 'success' | 'error';
  text: string;
}

function describeError(error: unknown): string {
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

  useEffect(() => {
    if (!snapshot || !snapshot.h3_jobs.some(({ status }) =>
      ['draft', 'submitting', 'queued', 'running', 'timed_out'].includes(status))) return;
    let active = true;
    const timer = window.setInterval(() => {
      void api.getProject(snapshot.project.id).then((next) => {
        if (active) setSnapshot(next);
      }).catch((error) => {
        if (active) setNotice({ tone: 'error', text: describeError(error) });
      });
    }, 2_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [snapshot]);

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

  const reviewActual = useCallback((actualId: string,
    verdict: 'approved' | 'rejected') => updateActual(
      () => api.reviewActual(actualId, verdict),
      verdict === 'approved' ? 'Take QC 已批准' : 'Take QC 已拒绝',
    ), [updateActual]);

  const generate = useCallback(async (shot: ShotPlan,
    preflight: GenerationPreflight, gateOverrideReason: string | null) => {
    if (!snapshot || !preflight.ready || !preflight.mode) return false;
    setBusy(true);
    try {
      const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
      await api.createH3Job(snapshot.project.id, shot.id, {
        mode: preflight.mode,
        provider: 'local_comfyui',
        model: 'H3-local',
        prompt: shot.prompt,
        duration_seconds: shot.duration_seconds,
        seed,
        steps: 4,
        idempotency_key: `studio-${crypto.randomUUID()}`,
        input_bindings: preflight.input_bindings,
        ...(gateOverrideReason ? { gate_override_reason: gateOverrideReason } : {}),
      });
      setSnapshot(await api.getProject(snapshot.project.id));
      setNotice({ tone: 'success', text: '生成任务已入队，可在分镜卡片查看进度' });
      return true;
    } catch (error) {
      setNotice({ tone: 'error', text: describeError(error) });
      return false;
    } finally { setBusy(false); }
  }, [snapshot]);

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
    reviewActual,
    generate,
    dismissNotice: () => setNotice(null),
  };
}
