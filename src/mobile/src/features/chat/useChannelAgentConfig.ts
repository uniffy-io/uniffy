import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { chatApi } from "@features/chat/chatApi";

export interface SerializedChannelAgentConfig {
  modelOverride: string;
  modelParamsOverrideJson: string;
}

export function channelAgentConfigKey(orgId: string | null, channelId: string, agentId: string) {
  return ["chat", "agentConfig", orgId, channelId, agentId];
}

/** Per-(channel, agent) model + parameter overrides; "" on either field = agent default. */
export function useChannelAgentConfig(channelId: string, agentId: string, enabled = true) {
  const { organizationId } = useAuth();

  return useQuery({
    queryKey: channelAgentConfigKey(organizationId, channelId, agentId),
    enabled: enabled && !!organizationId && !!channelId && !!agentId,
    queryFn: async (): Promise<SerializedChannelAgentConfig> => {
      const res = await chatApi.getChannelAgentConfig({
        organizationId: organizationId!,
        channelId,
        agentId,
      });
      return {
        modelOverride: res.config?.modelOverride ?? "",
        modelParamsOverrideJson: res.config?.modelParamsOverrideJson ?? "",
      };
    },
  });
}

/**
 * Optimistic per-field update with revert on error. An absent field leaves
 * the server value unchanged; "" clears that override.
 */
export function useUpdateChannelAgentConfig(channelId: string, agentId: string) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const key = channelAgentConfigKey(organizationId, channelId, agentId);

  return useMutation({
    mutationFn: (patch: { modelOverride?: string; modelParamsOverrideJson?: string }) =>
      chatApi.updateChannelAgentConfig({
        organizationId: organizationId!,
        channelId,
        agentId,
        modelOverride: patch.modelOverride,
        modelParamsOverrideJson: patch.modelParamsOverrideJson,
      }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<SerializedChannelAgentConfig>(key);
      queryClient.setQueryData<SerializedChannelAgentConfig>(key, (old) => ({
        modelOverride: patch.modelOverride ?? old?.modelOverride ?? "",
        modelParamsOverrideJson:
          patch.modelParamsOverrideJson ?? old?.modelParamsOverrideJson ?? "",
      }));
      return { previous };
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(key, ctx.previous);
      } else {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    onSuccess: (res) => {
      queryClient.setQueryData<SerializedChannelAgentConfig>(key, {
        modelOverride: res.config?.modelOverride ?? "",
        modelParamsOverrideJson: res.config?.modelParamsOverrideJson ?? "",
      });
    },
  });
}
