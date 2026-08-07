import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { chatApi } from "@features/chat/chatApi";
import { parseModelParamValues, type ModelParamValues } from "@features/agents/modelParamsSchema";

export interface SerializedChannelAgentConfig {
  modelOverride: string;
  modelParams: ModelParamValues;
  imageParams: ModelParamValues;
}

/** Absent field = leave unchanged; "" / empty params = clear the override. */
export interface ChannelAgentConfigPatch {
  modelOverride?: string;
  modelParams?: ModelParamValues;
  imageParams?: ModelParamValues;
}

export function channelAgentConfigKey(orgId: string | null, channelId: string, agentId: string) {
  return ["chat", "agentConfig", orgId, channelId, agentId];
}

const EMPTY_CONFIG: SerializedChannelAgentConfig = {
  modelOverride: "",
  modelParams: {},
  imageParams: {},
};

/** Per-(channel, agent) model and parameter overrides; "" = agent default. */
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
        modelParams: parseModelParamValues(res.config?.modelParamsOverride ?? ""),
        imageParams: parseModelParamValues(res.config?.imageParamsOverride ?? ""),
      };
    },
  });
}

/** The wire fields are optional strings: absent = unchanged, "" = clear. */
function toWirePatch(patch: ChannelAgentConfigPatch): {
  modelOverride?: string;
  modelParamsOverride?: string;
  imageParamsOverride?: string;
} {
  const wire: {
    modelOverride?: string;
    modelParamsOverride?: string;
    imageParamsOverride?: string;
  } = {};
  if (patch.modelOverride !== undefined) wire.modelOverride = patch.modelOverride;
  if (patch.modelParams !== undefined) {
    wire.modelParamsOverride =
      Object.keys(patch.modelParams).length > 0 ? JSON.stringify(patch.modelParams) : "";
  }
  if (patch.imageParams !== undefined) {
    wire.imageParamsOverride =
      Object.keys(patch.imageParams).length > 0 ? JSON.stringify(patch.imageParams) : "";
  }
  return wire;
}

/**
 * Optimistic update with revert on error. An absent field leaves the server
 * value unchanged; "" clears the override.
 */
export function useUpdateChannelAgentConfig(channelId: string, agentId: string) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const key = channelAgentConfigKey(organizationId, channelId, agentId);

  return useMutation({
    mutationFn: (patch: ChannelAgentConfigPatch) =>
      chatApi.updateChannelAgentConfig({
        organizationId: organizationId!,
        channelId,
        agentId,
        ...toWirePatch(patch),
      }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<SerializedChannelAgentConfig>(key);
      queryClient.setQueryData<SerializedChannelAgentConfig>(key, (old) => {
        const base = old ?? EMPTY_CONFIG;
        return {
          modelOverride: patch.modelOverride ?? base.modelOverride,
          modelParams: patch.modelParams ?? base.modelParams,
          imageParams: patch.imageParams ?? base.imageParams,
        };
      });
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
        modelParams: parseModelParamValues(res.config?.modelParamsOverride ?? ""),
        imageParams: parseModelParamValues(res.config?.imageParamsOverride ?? ""),
      });
    },
  });
}
