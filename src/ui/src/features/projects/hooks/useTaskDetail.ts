import { useCallback, useEffect, useMemo, useState } from "react";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useContentRefresh } from "@/features/notifications/hooks/useContentRefresh";
import { useTaskPermission } from "@/features/projects/hooks/useProjectPermissions";
import {
  applyLiveDescription,
  optimisticUpdateTask,
  selectTasksForProject,
  selectTasksMap,
} from "@/features/projects/store/projectsSlice";
import { fetchTask, updateTask } from "@/features/projects/store/projectsThunks";
import { selectSprintsForProject } from "@/features/projects/store/sprintsSlice";
import type { Task } from "@/features/projects/types";

const NO_TASKS: Task[] = [];
const TASK_GONE = /\[(not_found|permission_denied)\]/i;

export interface TaskAncestor {
  id: string;
  title: string;
  number: number;
}

/** Everything a task detail host shows, loaded and kept fresh for one task id. */
export function useTaskDetail(taskId: string) {
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const task = useAppSelector((state) => selectTasksMap(state)[taskId]);
  // The last load of this task id that failed: "gone" when the server refused or lost it, which
  // replaces any cached copy, "error" for anything else, which keeps the cached copy on screen.
  const [failure, setFailure] = useState<{ taskId: string; kind: "gone" | "error" } | null>(null);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(
    (isLive: () => boolean = () => true) => {
      void dispatch(fetchTask(taskId))
        .unwrap()
        .then((loaded) => {
          if (isLive()) setFailure(loaded ? null : { taskId, kind: "gone" });
        })
        .catch((error: unknown) => {
          if (!isLive()) return;
          setFailure({ taskId, kind: TASK_GONE.test(String(error)) ? "gone" : "error" });
        });
    },
    [dispatch, taskId],
  );

  useEffect(() => {
    let live = true;
    load(() => live);
    return () => {
      live = false;
    };
  }, [load, organizationId, attempt]);
  useContentRefresh(ContentType.TASK, taskId, () => load());

  // The task's own project, so a host works wherever it is mounted, not only inside a project page.
  const projectId = task?.projectId;
  const project = useAppSelector((state) =>
    projectId ? (state.projects.projects[projectId] ?? null) : null,
  );
  const allProjectTasks = useAppSelector(
    useMemo(() => (projectId ? selectTasksForProject(projectId) : () => NO_TASKS), [projectId]),
  );
  const blocksTaskIds = useMemo(
    () => allProjectTasks.filter((t) => t.blockedByTaskIds.includes(taskId)).map((t) => t.id),
    [allProjectTasks, taskId],
  );
  // Time logged on descendants, shown beside the task's own time; the Spent column and
  // the group sums stay own-time only so nothing double counts.
  const subtaskTimeSpent = useMemo(() => {
    const childrenOf = new Map<string, Task[]>();
    for (const t of allProjectTasks) {
      if (!t.parentId) continue;
      const siblings = childrenOf.get(t.parentId) ?? [];
      siblings.push(t);
      childrenOf.set(t.parentId, siblings);
    }
    let total = 0;
    const stack = [...(childrenOf.get(taskId) ?? [])];
    while (stack.length > 0) {
      const t = stack.pop()!;
      total += t.timeSpentMinutes ?? 0;
      stack.push(...(childrenOf.get(t.id) ?? []));
    }
    return total;
  }, [allProjectTasks, taskId]);
  const { canEdit } = useTaskPermission(taskId);
  const sprints = useAppSelector(selectSprintsForProject(projectId ?? ""));

  const onDescriptionDone = useCallback(
    (
      markdown: string,
      { realtimeOwned, baseContent }: { realtimeOwned: boolean; baseContent: string },
    ) => {
      if (realtimeOwned) {
        dispatch(applyLiveDescription({ id: taskId, description: markdown }));
        return;
      }
      // Trim-compare because the editor re-serializes markdown and can differ by trailing newlines alone.
      if (markdown.trim() === baseContent.trim()) return;
      dispatch(optimisticUpdateTask({ id: taskId, description: markdown }));
      void dispatch(
        updateTask({ id: taskId, description: markdown, baseDescription: baseContent }),
      );
    },
    [dispatch, taskId],
  );

  const ancestors = useMemo(() => {
    if (!task?.parentId) return [];
    const chain: TaskAncestor[] = [];
    const tasksMap: Record<string, Task> = {};
    for (const t of allProjectTasks) tasksMap[t.id] = t;
    let currentId: string | null = task.parentId;
    while (currentId && chain.length < 5) {
      const ancestor: Task | undefined = tasksMap[currentId];
      if (!ancestor) break;
      chain.unshift({ id: ancestor.id, title: ancestor.title, number: ancestor.number });
      currentId = ancestor.parentId;
    }
    return chain;
  }, [task, allProjectTasks]);

  return {
    task,
    loadFailed: failure?.taskId === taskId && failure.kind === "gone",
    loadError: failure?.taskId === taskId && failure.kind === "error",
    retry: () => setAttempt((n) => n + 1),
    project,
    allProjectTasks,
    blocksTaskIds,
    subtaskTimeSpent,
    canEdit,
    sprints,
    onDescriptionDone,
    ancestors,
  };
}
