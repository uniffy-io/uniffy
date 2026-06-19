import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { chatApi } from "@/api/chatApi";
import { channelTypeToProto, type ChannelType, type SerializedMessage } from "@/lib/chatSerializer";

function messagesKey(orgId: string | null, channelId: string) {
  return ["chat", "messages", orgId, channelId];
}

export function useSendMessage(channelId: string) {
  const { organizationId, user } = useAuth();
  const queryClient = useQueryClient();
  const key = messagesKey(organizationId, channelId);

  return useMutation({
    mutationFn: (args: { content: string; attachmentFileIds?: string[]; replyToId?: string }) =>
      chatApi.sendMessage({
        organizationId: organizationId!,
        channelId,
        content: args.content,
        attachmentFileIds: args.attachmentFileIds ?? [],
        replyToId: args.replyToId,
      }),
    onMutate: async (args) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<SerializedMessage[]>(key);
      const nowSeconds = Math.floor(Date.now() / 1000);
      const optimistic: SerializedMessage = {
        id: `optimistic-${nowSeconds}-${Math.round(nowSeconds % 100000)}`,
        channelId,
        senderId: user?.id ?? "",
        senderType: "USER",
        content: args.content,
        rootId: null,
        replyToId: args.replyToId ?? null,
        replyContext: null,
        editedAtSeconds: null,
        isDeleted: false,
        isPinned: false,
        metadata: { optimistic: "1" },
        createdAtSeconds: nowSeconds,
        createdAtIso: new Date(nowSeconds * 1000).toISOString(),
        timeLabel: "Sending...",
        replyCount: 0,
        reactions: [],
        senderName: user?.fullName || user?.username || "You",
        senderAvatarUrl: user?.avatarUrl || null,
      };
      queryClient.setQueryData<SerializedMessage[]>(key, (old) => [optimistic, ...(old ?? [])]);
      return { previous };
    },
    onError: (_err, _args, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useDeleteMessage(channelId: string) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (messageId: string) =>
      chatApi.deleteMessage({ organizationId: organizationId!, channelId, messageId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagesKey(organizationId, channelId) });
    },
  });
}

export function useToggleReaction(channelId: string) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { messageId: string; emoji: string; add: boolean }) => {
      if (args.add) {
        await chatApi.addReaction({
          organizationId: organizationId!,
          channelId,
          messageId: args.messageId,
          emoji: args.emoji,
        });
      } else {
        await chatApi.removeReaction({
          organizationId: organizationId!,
          channelId,
          messageId: args.messageId,
          emoji: args.emoji,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagesKey(organizationId, channelId) });
    },
  });
}

export function useEditMessage(channelId: string) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { messageId: string; content: string }) =>
      chatApi.updateMessage({
        organizationId: organizationId!,
        channelId,
        messageId: args.messageId,
        content: args.content,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagesKey(organizationId, channelId) });
    },
  });
}

export function usePinMessage(channelId: string) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { messageId: string; pin: boolean }) => {
      if (args.pin) {
        await chatApi.pinMessage({
          organizationId: organizationId!,
          channelId,
          messageId: args.messageId,
        });
      } else {
        await chatApi.unpinMessage({
          organizationId: organizationId!,
          channelId,
          messageId: args.messageId,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagesKey(organizationId, channelId) });
      queryClient.invalidateQueries({ queryKey: ["chat", "pinned", organizationId, channelId] });
    },
  });
}

export function useMarkChannelRead(channelId: string) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (lastReadMessageId: string) =>
      chatApi.markChannelRead({
        organizationId: organizationId!,
        channelId,
        lastReadMessageId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "unread", organizationId] });
    },
  });
}

export function useCreateChannel() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      name: string;
      channelType: ChannelType;
      description?: string;
      memberIds?: string[];
      categoryId?: string;
    }) =>
      chatApi.createChannel({
        organizationId: organizationId!,
        name: args.name,
        channelType: channelTypeToProto(args.channelType),
        description: args.description,
        memberIds: args.memberIds ?? [],
        categoryId: args.categoryId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "channels", organizationId] });
    },
  });
}

export function useCreateDm() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (memberIds: string[]) =>
      chatApi.createChannel({
        organizationId: organizationId!,
        name: "",
        channelType: channelTypeToProto(memberIds.length > 1 ? "GROUP_DM" : "DIRECT"),
        memberIds,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "channels", organizationId] });
    },
  });
}

export function useCreateCategory() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) =>
      chatApi.createCategory({ organizationId: organizationId!, name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "categories", organizationId] });
    },
  });
}

export function useJoinChannel() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (channelId: string) =>
      chatApi.joinChannel({ organizationId: organizationId!, channelId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "channels", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["chat", "browse", organizationId] });
    },
  });
}

export function useLeaveChannel() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (channelId: string) =>
      chatApi.leaveChannel({ organizationId: organizationId!, channelId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "channels", organizationId] });
    },
  });
}
