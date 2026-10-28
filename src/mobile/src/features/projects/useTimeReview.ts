import { Alert } from "react-native";
import {
  useMutation,
  useInfiniteQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { projectsApi } from "@features/projects/projectsApi";
import type { SerializedTimesheetStatus } from "@features/projects/timeSerializer";
import { timesheetQueryKey } from "@features/projects/useMyTime";
import { serverMessage } from "@features/projects/useProjectMutations";
import { reviewInboxOptions, reviewInboxQueryKey } from "@features/projects/timeQueries";

export { reviewInboxQueryKey } from "@features/projects/timeQueries";

export function useReviewInbox(
  day: string,
  options: { status?: SerializedTimesheetStatus; query?: string; enabled?: boolean } = {},
) {
  const { organizationId } = useAuth();
  return useInfiniteQuery(
    reviewInboxOptions(organizationId, day, options, projectsApi.listReviewTimesheets),
  );
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
