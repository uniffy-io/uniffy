import { Alert } from "react-native";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { TimePeriodStatus, TimesheetStatus } from "@uniffy/proto/projects/v1/time_pb";
import { useAuth } from "@core/providers/AuthContext";
import { projectsApi } from "@features/projects/projectsApi";
import {
  reviewRowToPlain,
  type SerializedReviewRow,
  type SerializedTimesheetStatus,
} from "@features/projects/timeSerializer";
import { timesheetQueryKey } from "@features/projects/useMyTime";
import { serverMessage } from "@features/projects/useProjectMutations";

export function reviewInboxQueryKey(organizationId: string | null) {
  return ["review-inbox", organizationId] as const;
}

const STATUS_FILTER: Record<SerializedTimesheetStatus, TimesheetStatus> = {
  open: TimesheetStatus.OPEN,
  submitted: TimesheetStatus.SUBMITTED,
  approved: TimesheetStatus.APPROVED,
  rejected: TimesheetStatus.REJECTED,
};

export interface ReviewInbox {
  rows: SerializedReviewRow[];
  periodStart: string;
  periodEnd: string;
  periodClosed: boolean;
  viewerIsTimekeepingAdmin: boolean;
}

/** The people the caller reviews for the period holding `day`. */
export function useReviewInbox(
  day: string,
  options: { status?: SerializedTimesheetStatus; query?: string; enabled?: boolean } = {},
) {
  const { organizationId } = useAuth();
  const query = options.query?.trim() ?? "";
  return useQuery({
    queryKey: [...reviewInboxQueryKey(organizationId), day, options.status ?? "all", query],
    queryFn: async (): Promise<ReviewInbox> => {
      const response = await projectsApi.listReviewTimesheets({
        organizationId: organizationId!,
        periodStart: day,
        status: options.status ? STATUS_FILTER[options.status] : undefined,
        query,
        pageSize: 200,
      });
      return {
        rows: response.rows.map(reviewRowToPlain),
        periodStart: response.period?.startDate ?? day,
        periodEnd: response.period?.endDate ?? day,
        periodClosed: response.period?.status === TimePeriodStatus.CLOSED,
        viewerIsTimekeepingAdmin: response.viewerIsTimekeepingAdmin,
      };
    },
    enabled: !!organizationId && options.enabled !== false,
    placeholderData: keepPreviousData,
  });
}

function refreshReview(queryClient: QueryClient, organizationId: string | null) {
  queryClient.invalidateQueries({ queryKey: reviewInboxQueryKey(organizationId) });
  queryClient.invalidateQueries({ queryKey: timesheetQueryKey(organizationId) });
}

export function useApproveTimesheet() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { timesheetId: string; comment?: string }) => {
      await projectsApi.approveTimesheet({
        organizationId: organizationId!,
        timesheetId: args.timesheetId,
        comment: args.comment ?? "",
      });
    },
    onSuccess: () => refreshReview(queryClient, organizationId),
    onError: (error) => {
      Alert.alert("Could not approve", serverMessage(error, "The timesheet was not approved"));
    },
  });
}

/** The reason is required; the person reads it on their week. */
export function useRejectTimesheet() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { timesheetId: string; comment: string }) => {
      await projectsApi.rejectTimesheet({
        organizationId: organizationId!,
        timesheetId: args.timesheetId,
        comment: args.comment,
      });
    },
    onSuccess: () => refreshReview(queryClient, organizationId),
    onError: (error) => {
      Alert.alert("Could not reject", serverMessage(error, "The timesheet was not rejected"));
    },
  });
}

/** Lets the person edit a locked period again for the given hours. */
export function useGrantGrace() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { userId: string; day: string; hours: number }) => {
      await projectsApi.grantGrace({
        organizationId: organizationId!,
        userId: args.userId,
        periodStart: args.day,
        hours: args.hours,
      });
    },
    onSuccess: () => refreshReview(queryClient, organizationId),
    onError: (error) => {
      Alert.alert("Could not grant grace", serverMessage(error, "Nothing changed"));
    },
  });
}
