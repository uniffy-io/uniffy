import { infiniteQueryOptions } from "@tanstack/react-query";
import { TimePeriodStatus, TimesheetStatus } from "@uniffy/proto/projects/v1/time_pb";
import type { projectsApi } from "@features/projects/projectsApi";
import {
  reviewRowToPlain,
  worklogToPlain,
  type SerializedTimesheetStatus,
} from "@features/projects/timeSerializer";

const PAGE_SIZE = 50;
const STATUS_FILTER: Record<SerializedTimesheetStatus, TimesheetStatus> = {
  open: TimesheetStatus.OPEN,
  submitted: TimesheetStatus.SUBMITTED,
  approved: TimesheetStatus.APPROVED,
  rejected: TimesheetStatus.REJECTED,
};

export function reviewInboxQueryKey(organizationId: string | null) {
  return ["review-inbox", organizationId] as const;
}

export function taskWorklogsQueryKey(organizationId: string | null, taskId: string) {
  return ["task-worklogs", organizationId, taskId] as const;
}

export function taskWorklogOptions(
  organizationId: string | null,
  taskId: string,
  fetchPage: typeof projectsApi.listTaskWorklogs,
) {
  return infiniteQueryOptions({
    queryKey: taskWorklogsQueryKey(organizationId, taskId),
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const response = await fetchPage(
        { organizationId: organizationId!, taskId, pageSize: PAGE_SIZE, pageToken: pageParam },
        { signal },
      );
      return {
        worklogs: response.worklogs.map(worklogToPlain),
        nextPageToken: response.nextPageToken,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextPageToken || undefined,
    select: (data) =>
      [
        ...new Map(
          data.pages.flatMap((page) => page.worklogs).map((row) => [row.id, row]),
        ).values(),
      ].sort(
        (a, b) => b.workDate.localeCompare(a.workDate) || b.createdAt.localeCompare(a.createdAt),
      ),
    enabled: !!organizationId && !!taskId,
  });
}

export function reviewInboxOptions(
  organizationId: string | null,
  day: string,
  options: { status?: SerializedTimesheetStatus; query?: string; enabled?: boolean },
  fetchPage: typeof projectsApi.listReviewTimesheets,
) {
  const query = options.query?.trim() ?? "";
  return infiniteQueryOptions({
    queryKey: [...reviewInboxQueryKey(organizationId), day, options.status ?? "all", query],
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const response = await fetchPage(
        {
          organizationId: organizationId!,
          periodStart: day,
          status: options.status ? STATUS_FILTER[options.status] : undefined,
          query,
          pageSize: PAGE_SIZE,
          pageToken: pageParam,
        },
        { signal },
      );
      return {
        rows: response.rows.map(reviewRowToPlain),
        periodStart: response.period?.startDate ?? day,
        periodEnd: response.period?.endDate ?? day,
        periodClosed: response.period?.status === TimePeriodStatus.CLOSED,
        viewerIsTimekeepingAdmin: response.viewerIsTimekeepingAdmin,
        nextPageToken: response.nextPageToken,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextPageToken || undefined,
    select: (data) => ({
      ...data.pages[0],
      rows: [
        ...new Map(
          data.pages.flatMap((page) => page.rows).map((row) => [row.userId, row]),
        ).values(),
      ],
    }),
    enabled: !!organizationId && options.enabled !== false,
  });
}
