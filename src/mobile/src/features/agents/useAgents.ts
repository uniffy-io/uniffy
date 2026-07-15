import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@core/providers/auth-context";
import { agentsApi } from "@features/agents/agentsApi";
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
