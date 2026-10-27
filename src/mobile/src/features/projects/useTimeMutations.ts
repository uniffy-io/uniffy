import { Alert } from "react-native";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { getEffectiveTimeZone } from "@core/datetimePrefs";
import { useAuth } from "@core/providers/AuthContext";
import { projectsApi } from "@features/projects/projectsApi";
import { localDayKey, timerToPlain, worklogToPlain } from "@features/projects/timeSerializer";
import { timerQueryKey } from "@features/projects/useActiveTimer";
import {
  myWeekQueryKey,
  taskWorklogsQueryKey,
  timesheetQueryKey,
} from "@features/projects/useMyTime";
import { serverMessage } from "@features/projects/useProjectMutations";

/** A write can move the period's sheet (an edit sends an approved sheet back for review). */
function refreshAfterWrite(
  queryClient: QueryClient,
  organizationId: string | null,
  taskId: string,
  projectId: string,
) {
  queryClient.invalidateQueries({ queryKey: ["task", organizationId, taskId] });
  queryClient.invalidateQueries({ queryKey: ["tasks", organizationId, projectId] });
  queryClient.invalidateQueries({ queryKey: taskWorklogsQueryKey(organizationId, taskId) });
  queryClient.invalidateQueries({ queryKey: myWeekQueryKey(organizationId) });
  queryClient.invalidateQueries({ queryKey: timesheetQueryKey(organizationId) });
}

export function useCreateWorklog() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      taskId: string;
      workDate: string;
      durationMinutes: number;
      description?: string;
      /** ISO instant the work began; absent for a day-only entry. */
      startedAt?: string | null;
    }) => {
      const response = await projectsApi.createWorklog({
        organizationId: organizationId!,
        taskId: args.taskId,
        workDate: args.workDate,
        durationMinutes: args.durationMinutes,
        description: args.description ?? "",
        startedAt: args.startedAt ? timestampFromDate(new Date(args.startedAt)) : undefined,
        timeZone: getEffectiveTimeZone(),
      });
      return {
        worklog: worklogToPlain(response.worklog!),
        taskTimeSpentMinutes: response.taskTimeSpentMinutes,
      };
    },
    onSuccess: (data) =>
      refreshAfterWrite(queryClient, organizationId, data.worklog.taskId, data.worklog.projectId),
    onError: (error) => {
      Alert.alert("Could not log time", timeErrorMessage(error, "The time entry was not saved"));
    },
  });
}

export function useUpdateWorklog() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      worklogId: string;
      workDate?: string;
      durationMinutes?: number;
      description?: string;
      /** An ISO instant moves the entry on the clock; null takes it off the clock. */
      startedAt?: string | null;
    }) => {
      const response = await projectsApi.updateWorklog({
        organizationId: organizationId!,
        worklogId: args.worklogId,
        workDate: args.workDate,
        durationMinutes: args.durationMinutes,
        description: args.description,
        startedAt: args.startedAt ? timestampFromDate(new Date(args.startedAt)) : undefined,
        clearStartedAt: args.startedAt === null,
        timeZone: getEffectiveTimeZone(),
      });
      return {
        worklog: worklogToPlain(response.worklog!),
        taskTimeSpentMinutes: response.taskTimeSpentMinutes,
      };
    },
    onSuccess: (data) =>
      refreshAfterWrite(queryClient, organizationId, data.worklog.taskId, data.worklog.projectId),
    onError: (error) => {
      Alert.alert("Could not save the entry", timeErrorMessage(error, "The entry was not changed"));
    },
  });
}

export function useDeleteWorklog() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { worklogId: string; projectId: string }) => {
      const response = await projectsApi.deleteWorklog({
        organizationId: organizationId!,
        worklogId: args.worklogId,
      });
      return { taskId: response.taskId, taskTimeSpentMinutes: response.taskTimeSpentMinutes };
    },
    onSuccess: (data, variables) =>
      refreshAfterWrite(queryClient, organizationId, data.taskId, variables.projectId),
    onError: (error) => {
      Alert.alert(
        "Could not delete the entry",
        timeErrorMessage(error, "The entry is still there"),
      );
    },
  });
}

/** A timer running on another task is stopped first and its entry lands on today's day. */
export function useStartTimer() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { taskId: string; projectId: string }) => {
      const response = await projectsApi.startTimer({
        organizationId: organizationId!,
        taskId: args.taskId,
        description: "",
        workDate: localDayKey(),
      });
      return {
        timer: timerToPlain(response.timer!),
        stoppedWorklog: response.stoppedWorklog ? worklogToPlain(response.stoppedWorklog) : null,
      };
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData(timerQueryKey(organizationId), data.timer);
      if (data.stoppedWorklog) {
        refreshAfterWrite(
          queryClient,
          organizationId,
          data.stoppedWorklog.taskId,
          data.stoppedWorklog.projectId,
        );
      }
      queryClient.invalidateQueries({ queryKey: ["tasks", organizationId, variables.projectId] });
    },
    onError: (error) => {
      Alert.alert("Could not start the timer", timeErrorMessage(error, "The timer did not start"));
    },
  });
}

export function usePauseTimer() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await projectsApi.pauseTimer({ organizationId: organizationId! });
      return timerToPlain(response.timer!);
    },
    onSuccess: (timer) => queryClient.setQueryData(timerQueryKey(organizationId), timer),
    onError: (error) => {
      Alert.alert("Could not pause the timer", serverMessage(error, "The timer kept running"));
    },
  });
}

export function useResumeTimer() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await projectsApi.resumeTimer({ organizationId: organizationId! });
      return timerToPlain(response.timer!);
    },
    onSuccess: (timer) => queryClient.setQueryData(timerQueryKey(organizationId), timer),
    onError: (error) => {
      Alert.alert("Could not resume the timer", serverMessage(error, "The timer stayed paused"));
    },
  });
}

/** Stops on the device's calendar day; the server rounds the elapsed time by the org policy. */
export function useStopTimer() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { taskId: string; projectId: string; discard?: boolean }) => {
      const response = await projectsApi.stopTimer({
        organizationId: organizationId!,
        workDate: localDayKey(),
        discard: args.discard ?? false,
      });
      return {
        worklog: response.worklog ? worklogToPlain(response.worklog) : null,
        taskTimeSpentMinutes: response.taskTimeSpentMinutes,
      };
    },
    onSuccess: (_data, variables) => {
      queryClient.setQueryData(timerQueryKey(organizationId), null);
      refreshAfterWrite(queryClient, organizationId, variables.taskId, variables.projectId);
    },
    onError: (error) => {
      Alert.alert(
        "Could not stop the timer",
        timeErrorMessage(error, "The timer is still running"),
      );
    },
  });
}

/** Sends the period holding `day` to one reviewer, or to all of them when none is picked. */
export function useSubmitTimesheet() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { day: string; comment: string; reviewerUserId?: string }) => {
      await projectsApi.submitTimesheet({
        organizationId: organizationId!,
        periodStart: args.day,
        comment: args.comment,
        reviewerUserId: args.reviewerUserId,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: timesheetQueryKey(organizationId) }),
    onError: (error) => {
      Alert.alert("Could not submit", serverMessage(error, "The timesheet was not submitted"));
    },
  });
}

export function useRecallTimesheet() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { day: string }) => {
      await projectsApi.recallTimesheet({
        organizationId: organizationId!,
        periodStart: args.day,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: timesheetQueryKey(organizationId) }),
    onError: (error) => {
      Alert.alert("Could not recall", serverMessage(error, "The timesheet is still in review"));
    },
  });
}

/**
 * The server names the locked day or the disabled policy in its refusal; the
 * person needs what to do next, not the field it came from.
 */
export function timeErrorMessage(error: unknown, fallback: string): string {
  const message = serverMessage(error, fallback);
  if (/is locked/.test(message)) {
    return "This day is locked. Recall the timesheet or ask your reviewer to reopen it.";
  }
  if (/turned off/.test(message)) {
    return "Time tracking is turned off for this organization.";
  }
  return message;
}
