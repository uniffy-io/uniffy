import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { agentsApi, providersApi, sessionsApi } from "@features/agents/agentsApi";
import { chatApi } from "@features/chat/chatApi";
import { messagesKey } from "@features/chat/useChatMutations";
import type { SerializedMessage } from "@features/chat/chatSerializer";
import { agentToPlain, type SerializedAgent } from "@features/agents/agentSerializer";
import { rememberToolLabels } from "@features/agents/toolLabels";

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
 * The shipped tool catalog, fetched only for its display names: tool panes label
 * their steps from it and fall back to the wire name until it lands. Identical
 * for every org, so it is fetched once per session.
 */
export function useAgentTools() {
  const { organizationId, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["agents", "tools", organizationId],
    enabled: !!organizationId && isAuthenticated,
    staleTime: Infinity,
    queryFn: async (): Promise<{ name: string; displayName: string }[]> => {
      const res = await agentsApi.listTools({ organizationId: organizationId! });
      const tools = res.tools.map((tool) => ({
        name: tool.name,
        displayName: tool.displayName,
      }));
      rememberToolLabels(tools);
      return tools;
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
          })
        : await providersApi.listAvailableModels({
            organizationId: organizationId!,
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

export const IMAGE_GENERATION_TOOL = "images.generate_image";

export interface AgentImageModelOption {
  id: string;
  imageParameterSchemaJson: string;
}

/**
 * Image-generation models under a key. Separate from `useAgentModels` because
 * the image model usually sits under a DIFFERENT provider key than the chat
 * model, so it is absent from that list.
 */
export function useAgentImageModels(providerKeyId: string, enabled: boolean) {
  const { organizationId, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["agents", "imageModels", organizationId, providerKeyId || "org"],
    enabled: enabled && !!organizationId && isAuthenticated,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<AgentImageModelOption[]> => {
      const res = providerKeyId
        ? await providersApi.listModelsForKey({
            organizationId: organizationId!,
            keyId: providerKeyId,
          })
        : await providersApi.listAvailableModels({ organizationId: organizationId! });
      return res.models
        .filter((m) => m.supportsImageGeneration)
        .map((m) => ({ id: m.id, imageParameterSchemaJson: m.imageParameterSchemaJson }));
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

/**
 * Always opens a fresh chat with the agent rather than resuming the latest one -
 * several concurrent chats with the same agent is a supported shape.
 */
export function useCreateAgentChat() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (agentId: string): Promise<string> => {
      const created = await chatApi.createAgentChat({ organizationId: organizationId!, agentId });
      return created.channel?.id ?? "";
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "channels", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["chat", "agentChats", organizationId] });
    },
  });
}

/**
 * Thumbs rating on an agent's chat reply. The agents feedback RPC takes exactly
 * one target, so chat replies go in as `chatMessageId`; re-sending the rating
 * already showing clears it.
 */
export function useSubmitAgentReplyFeedback(channelId: string) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const key = messagesKey(organizationId, channelId);

  return useMutation({
    mutationFn: (args: { messageId: string; rating: "up" | "down" | "" }) =>
      sessionsApi.submitMessageFeedback({
        organizationId: organizationId!,
        chatMessageId: args.messageId,
        rating: args.rating,
      }),
    onMutate: async (args) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<SerializedMessage[]>(key);
      queryClient.setQueryData<SerializedMessage[]>(key, (old) =>
        old?.map((m) => (m.id === args.messageId ? { ...m, feedbackRating: args.rating } : m)),
      );
      return { previous };
    },
    onError: (_err, _args, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous);
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
