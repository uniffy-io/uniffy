import { Alert } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { projectsApi } from "@features/projects/projectsApi";
import { localDayKey, timerToPlain, worklogToPlain } from "@features/projects/timeSerializer";
import { timerQueryKey } from "@features/projects/useActiveTimer";
import { serverMessage } from "@features/projects/useProjectMutations";

export function useCreateWorklog() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      taskId: string;
      projectId: string;
      workDate: string;
      durationMinutes: number;
      description?: string;
    }) => {
      const response = await projectsApi.createWorklog({
        organizationId: organizationId!,
        taskId: args.taskId,
        workDate: args.workDate,
        durationMinutes: args.durationMinutes,
        description: args.description ?? "",
      });
      return {
        worklog: worklogToPlain(response.worklog!),
        taskTimeSpentMinutes: response.taskTimeSpentMinutes,
      };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["task", organizationId, variables.taskId] });
      queryClient.invalidateQueries({ queryKey: ["tasks", organizationId, variables.projectId] });
    },
    onError: (error) => {
      Alert.alert("Could not log time", serverMessage(error, "The time entry was not saved"));
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
        queryClient.invalidateQueries({
          queryKey: ["task", organizationId, data.stoppedWorklog.taskId],
        });
        queryClient.invalidateQueries({
          queryKey: ["tasks", organizationId, data.stoppedWorklog.projectId],
        });
      }
      queryClient.invalidateQueries({ queryKey: ["tasks", organizationId, variables.projectId] });
    },
    onError: (error) => {
      Alert.alert("Could not start the timer", serverMessage(error, "The timer did not start"));
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
      queryClient.invalidateQueries({ queryKey: ["task", organizationId, variables.taskId] });
      queryClient.invalidateQueries({ queryKey: ["tasks", organizationId, variables.projectId] });
    },
    onError: (error) => {
      Alert.alert("Could not stop the timer", serverMessage(error, "The timer is still running"));
    },
  });
}
