import { useMemo } from "react";
import { useAppSelector } from "@/app/hooks";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";
import { useTaskFilterContext } from "@/features/projects/hooks/useTasks";
import { selectTasksForProject } from "@/features/projects/store/projectsSlice";
import { selectSprintsForProject } from "@/features/projects/store/sprintsSlice";
import type { Task } from "@/features/projects/types";
import type { ViewGroupBy } from "@/features/projects/types/views";
import { taskRefValue } from "@/features/projects/utils/filterTasks";
import {
  groupTasks,
  type GroupContext,
  type TaskGroup,
} from "@/features/projects/utils/groupTasks";
import { toIdList } from "@/features/projects/utils/taskFieldValue";
import { fieldKindOf } from "@/features/projects/utils/viewFields";

export interface TaskGrouping {
  /** Null when the view does not group or names a field the project no longer has. */
  groups: TaskGroup[] | null;
  ctx: GroupContext;
}

/** The open view's group-by applied to the tasks one layout renders. */
export function useTaskGroups(
  projectId: string,
  tasks: readonly Task[],
  groupBy: ViewGroupBy | null,
): TaskGrouping {
  const selectProjectTasks = useMemo(() => selectTasksForProject(projectId), [projectId]);
  const projectTasks = useAppSelector(selectProjectTasks);
  const filterCtx = useTaskFilterContext(projectId, projectTasks);
  const sprints = useAppSelector(selectSprintsForProject(projectId));
  const tagsById = useAppSelector((state) => state.tags.byId);

  const personIds = useMemo(() => {
    if (!groupBy) return [];
    const kind = fieldKindOf(groupBy.field, filterCtx.fieldsById);
    if (kind !== "person" && kind !== "single_person") return [];
    const ids = new Set<string>();
    for (const task of tasks) {
      for (const id of toIdList(taskRefValue(task, groupBy.field, filterCtx))) ids.add(id);
    }
    return [...ids].sort();
  }, [groupBy, tasks, filterCtx]);
  const { subjects } = useSubjectResolver(personIds);

  const epics = useMemo(
    () => projectTasks.filter((task) => task.taskType === "epic"),
    [projectTasks],
  );

  const ctx = useMemo<GroupContext>(() => {
    const names = new Map(subjects.map((subject) => [subject.id, subject.name]));
    return {
      ...filterCtx,
      sprints,
      epics,
      tagOf: (id) => {
        const tag = tagsById[id];
        return tag ? { name: tag.name, color: tag.color || undefined } : undefined;
      },
      nameOf: (id) => names.get(id),
    };
  }, [filterCtx, sprints, epics, tagsById, subjects]);

  const groups = useMemo(() => {
    if (!groupBy) return null;
    const subjectsById = new Map(subjects.map((subject) => [subject.id, subject]));
    return (
      groupTasks(tasks, groupBy, ctx)?.map((group) => ({
        ...group,
        subject:
          group.display === "person" && group.value.kind === "id"
            ? subjectsById.get(group.value.id)
            : undefined,
      })) ?? null
    );
  }, [tasks, groupBy, ctx, subjects]);

  return { groups, ctx };
}
