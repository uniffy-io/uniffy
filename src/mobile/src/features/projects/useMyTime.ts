import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";
import { useAuth } from "@core/providers/AuthContext";
import { projectsApi } from "@features/projects/projectsApi";
import {
  dayTotalToPlain,
  timePolicyToPlain,
  worklogToPlain,
  type SerializedDayTotal,
  type SerializedWorklog,
} from "@features/projects/timeSerializer";
import { searchApi } from "@features/search/searchApi";
import { idFromUrn } from "@features/search/searchSerializer";

const SEARCH_LIMIT = 20;

export function timePolicyQueryKey(organizationId: string | null) {
  return ["time-policy", organizationId] as const;
}

export function myWeekQueryKey(organizationId: string | null) {
  return ["my-week", organizationId] as const;
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

export interface TaskHit {
  id: string;
  title: string;
  subtitle?: string;
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
      return response.items.map((item) => ({
        id: idFromUrn(item.urn),
        title: item.title,
        subtitle: item.description || undefined,
      }));
    },
    enabled: !!organizationId && trimmed.length > 0,
    placeholderData: keepPreviousData,
  });
}
