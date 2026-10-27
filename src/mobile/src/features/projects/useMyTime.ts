import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";
import { useAuth } from "@core/providers/AuthContext";
import { projectsApi } from "@features/projects/projectsApi";
import {
  dayTotalToPlain,
  timePolicyToPlain,
  timesheetToPlain,
  worklogToPlain,
  type SerializedDayTotal,
  type SerializedTimesheet,
  type SerializedWorklog,
} from "@features/projects/timeSerializer";
import { taskUrn } from "@features/projects/useTaskLabels";
import { searchApi } from "@features/search/searchApi";
import { idFromUrn } from "@features/search/searchSerializer";

const SEARCH_LIMIT = 20;

export function timePolicyQueryKey(organizationId: string | null) {
  return ["time-policy", organizationId] as const;
}

export function myWeekQueryKey(organizationId: string | null) {
  return ["my-week", organizationId] as const;
}

export function timesheetQueryKey(organizationId: string | null) {
  return ["timesheet", organizationId] as const;
}

export function taskWorklogsQueryKey(organizationId: string | null, taskId: string) {
  return ["task-worklogs", organizationId, taskId] as const;
}

export function useTimePolicy() {
  const { organizationId } = useAuth();
  return useQuery({
    queryKey: timePolicyQueryKey(organizationId),
    queryFn: async () => {
      const response = await projectsApi.getTimePolicy({ organizationId: organizationId! });
      return timePolicyToPlain(response.policy!);
    },
    enabled: !!organizationId,
    staleTime: 60_000,
  });
}

export interface MyWeek {
  worklogs: SerializedWorklog[];
  days: SerializedDayTotal[];
}

/** The person's own entries and what each day asks, over an inclusive day range. */
export function useMyWeek(from: string, to: string) {
  const { organizationId } = useAuth();
  return useQuery({
    queryKey: [...myWeekQueryKey(organizationId), from, to],
    queryFn: async (): Promise<MyWeek> => {
      const response = await projectsApi.listUserWorklogs({
        organizationId: organizationId!,
        fromDate: from,
        toDate: to,
      });
      return {
        worklogs: response.worklogs.map(worklogToPlain),
        days: response.days.map(dayTotalToPlain),
      };
    },
    enabled: !!organizationId,
  });
}

/** The person's own sheet for the period holding `day`; only fetched when approvals are on. */
export function useTimesheet(day: string, enabled: boolean) {
  const { organizationId } = useAuth();
  return useQuery({
    queryKey: [...timesheetQueryKey(organizationId), day],
    queryFn: async (): Promise<SerializedTimesheet> => {
      const response = await projectsApi.getTimesheet({
        organizationId: organizationId!,
        periodStart: day,
      });
      return timesheetToPlain(response.timesheet!);
    },
    enabled: !!organizationId && enabled,
    placeholderData: keepPreviousData,
  });
}

/** Everyone's entries on one task, newest day first; readable by whoever can view the task. */
export function useTaskWorklogs(taskId: string) {
  const { organizationId } = useAuth();
  return useQuery({
    queryKey: taskWorklogsQueryKey(organizationId, taskId),
    queryFn: async (): Promise<SerializedWorklog[]> => {
      const response = await projectsApi.listTaskWorklogs({
        organizationId: organizationId!,
        taskId,
      });
      return response.worklogs
        .map(worklogToPlain)
        .sort(
          (a, b) => b.workDate.localeCompare(a.workDate) || b.createdAt.localeCompare(a.createdAt),
        );
    },
    enabled: !!organizationId && !!taskId,
  });
}

export interface TaskHit {
  id: string;
  title: string;
  /** "REL-12" when the resolver names the project. */
  code: string | null;
  type: string;
  projectName: string;
}

/** Tasks matching a typed query, for picking one the week does not show yet. */
export function useTaskSearch(query: string) {
  const { organizationId } = useAuth();
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["task-search", organizationId, trimmed],
    queryFn: async (): Promise<TaskHit[]> => {
      const response = await searchApi.search({
        organizationId: organizationId!,
        query: trimmed,
        typeFilters: [SearchResultType.TASK],
        limit: SEARCH_LIMIT,
      });
      // The index carries only the title; the resolver adds the code, type and project
      // so tasks with the same title can be told apart.
      const urns = response.items.map((item) => item.urn);
      const resolved =
        urns.length > 0
          ? (await searchApi.resolveUrns({ organizationId: organizationId!, urns })).resolved
          : {};
      return response.items.map((item) => {
        const id = idFromUrn(item.urn);
        const meta = resolved[taskUrn(id)];
        return {
          id,
          title: meta?.title || item.title,
          code:
            meta?.projectSlug && meta.taskNumber
              ? `${meta.projectSlug.toUpperCase()}-${meta.taskNumber}`
              : null,
          type: meta?.taskType || "task",
          projectName: meta?.projectName ?? "",
        };
      });
    },
    enabled: !!organizationId && trimmed.length > 0,
    placeholderData: keepPreviousData,
  });
}
