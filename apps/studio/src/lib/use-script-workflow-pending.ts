import { useEffect, useState } from 'react';
import type { ProjectSnapshot } from '@h3storyboard/protocol';
import { listScriptVersions } from './script-api.js';

export interface ScriptWorkflowState {
  pending: boolean;
  resolved: boolean;
}

export function useScriptWorkflowPending(
  snapshot: ProjectSnapshot | null,
): ScriptWorkflowState {
  const projectId = snapshot?.project.id ?? null;
  const currentPlans = snapshot?.shot_plans.filter((shot) =>
    shot.source_compilation_id ===
      snapshot.project.active_script_compilation_id) ?? [];
  const activeScriptPlans = snapshot?.shot_plans.filter((shot) =>
    shot.script_version_id === snapshot.project.active_script_version_id) ?? [];
  const snapshotPending = Boolean(snapshot &&
    (snapshot.shot_plans.length === 0 || activeScriptPlans.some((shot) =>
      shot.planning_status === 'draft') || currentPlans.some((shot) =>
      shot.script_version_id !== snapshot.project.active_script_version_id)));
  const [remote, setRemote] = useState<{
    projectId: string | null;
    pending: boolean;
  }>({ projectId: null, pending: false });

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void listScriptVersions(projectId).then((versions) => {
      if (active) setRemote({ projectId, pending: snapshotPending ||
        versions.some(({ status }) => status === 'draft') });
    }).catch(() => {
      if (active) setRemote({ projectId, pending: true });
    });
    return () => { active = false; };
  }, [projectId, snapshotPending]);

  if (!projectId) return { pending: false, resolved: false };
  if (snapshotPending) return { pending: true, resolved: true };
  if (remote.projectId === projectId) {
    return { pending: remote.pending, resolved: true };
  }
  return { pending: false, resolved: false };
}
