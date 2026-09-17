import { useMemo } from "react";
import { useAppSelector } from "@/app/hooks";
import { effectiveDayKey } from "@/shared/utils/dateFormatting";
import { categorizeMyTasks, type MyTaskGroups } from "@/features/dashboard/utils/myTasks";

/** The signed-in user's open tasks from every loaded project, bucketed once for all dashboard surfaces. */
export function useMyTasks(): MyTaskGroups & { totalCount: number } {
  const tasks = useAppSelector((state) => state.projects.tasks);
  const userId = useAppSelector((state) => state.auth.user?.id ?? "");

  return useMemo(() => {
    const groups = categorizeMyTasks(Object.values(tasks), userId, effectiveDayKey(new Date()));
    return {
      ...groups,
      totalCount: groups.overdue.length + groups.dueToday.length + groups.upcoming.length,
    };
  }, [tasks, userId]);
}
