import { Alert } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { projectsApi } from "@features/projects/projectsApi";
import { worklogToPlain } from "@features/projects/timeSerializer";
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
