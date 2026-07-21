import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { agentsApi, providersApi } from "@features/agents/agentsApi";
import { chatApi } from "@features/chat/chatApi";
import { agentToPlain, type SerializedAgent } from "@features/agents/agentSerializer";

export function useAgents() {
  const { organizationId, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["agents", organizationId],
    enabled: !!organizationId && isAuthenticated,
    queryFn: async (): Promise<SerializedAgent[]> => {
      const res = await agentsApi.listAgents({
        organizationId: organizationId!,
        pagination: { page: 1, pageSize: 100 },
      });
      return res.agents.map(agentToPlain);
    },
  });
}

export interface AgentModelOption {
  id: string;
  displayName: string;
  provider: string;
  parameterSchemaJson: string;
}

/**
 * Catalog-known chat models an agent can run: scoped to its pinned provider
 * key when set, otherwise the org-wide list across all enabled keys.
 */
export function useAgentModels(providerKeyId: string, enabled: boolean) {
  const { organizationId, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["agents", "models", organizationId, providerKeyId || "org"],
    enabled: enabled && !!organizationId && isAuthenticated,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<AgentModelOption[]> => {
      const res = providerKeyId
        ? await providersApi.listModelsForKey({
            organizationId: organizationId!,
            keyId: providerKeyId,
            forceRefresh: false,
          })
        : await providersApi.listAvailableModels({
            organizationId: organizationId!,
            forceRefresh: false,
          });
      return res.models
        .filter((m) => m.catalogKnown && !m.supportsImageGeneration)
        .map((m) => ({
          id: m.id,
          displayName: m.displayName,
          provider: m.provider,
          parameterSchemaJson: m.parameterSchemaJson,
        }));
    },
  });
}

/**
 * Open a chat with an agent: resume the most recent existing chat for that
 * agent, or create a fresh one. Returns the channel id to navigate to.
 */
export function useStartAgentChat() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (agentId: string): Promise<string> => {
      const existing = await chatApi.listAgentChats({
        organizationId: organizationId!,
        agentId,
        pageSize: 1,
      });
      if (existing.channels.length > 0) {
        return existing.channels[0].id;
      }
      const created = await chatApi.createAgentChat({ organizationId: organizationId!, agentId });
      return created.channel?.id ?? "";
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "channels", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["chat", "agentChats", organizationId] });
    },
  });
}

export function useStopAgentRun() {
  const { organizationId } = useAuth();

  return useMutation({
    mutationFn: (args: { channelId: string; agentId: string }) =>
      chatApi.stopAgentRun({
        organizationId: organizationId!,
        channelId: args.channelId,
        agentId: args.agentId,
      }),
  });
}
