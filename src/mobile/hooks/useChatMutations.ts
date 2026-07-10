import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AgentConfirmationDecision } from "@uniffy/proto/chat/v1/chat_pb";
import { useAuth } from "@/context/auth-context";
import { chatApi } from "@/api/chatApi";
import {
  channelTypeToProto,
  notificationLevelToProto,
  type ChannelType,
  type NotificationLevel,
  type SerializedMessage,
} from "@/lib/chatSerializer";

export function messagesKey(orgId: string | null, channelId: string) {
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
      const nowSeconds = Math.floor(Date.now() / 1000);
      const optimisticId = `optimistic-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const optimistic: SerializedMessage = {
        id: optimisticId,
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
        // attachmentIds ride along so a failed send can be retried intact.
        metadata: {
          optimistic: "1",
          ...(args.attachmentFileIds?.length
            ? { attachmentIds: args.attachmentFileIds.join(",") }
            : {}),
        },
        createdAtSeconds: nowSeconds,
        createdAtIso: new Date(nowSeconds * 1000).toISOString(),
        timeLabel: "Sending...",
        replyCount: 0,
        reactions: [],
        senderName: user?.fullName || user?.username || "You",
        senderAvatarUrl: user?.avatarUrl || null,
        attachments: [],
      };
      queryClient.setQueryData<SerializedMessage[]>(key, (old) => [optimistic, ...(old ?? [])]);
      return { optimisticId };
    },
    // Failed sends stay in the list flagged for retry/discard instead of vanishing.
    // useMessages carries the flagged rows across poll refetches.
    onError: (_err, _args, ctx) => {
      if (!ctx) return;
      queryClient.setQueryData<SerializedMessage[]>(key, (old) =>
        (old ?? []).map((m) =>
          m.id === ctx.optimisticId
            ? { ...m, metadata: { ...m.metadata, failed: "1" }, timeLabel: "Not sent" }
            : m,
        ),
      );
    },
    onSuccess: (_res, _args, ctx) => {
      if (ctx) {
        queryClient.setQueryData<SerializedMessage[]>(key, (old) =>
          (old ?? []).filter((m) => m.id !== ctx.optimisticId),
        );
      }
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

/** Remove a failed optimistic message from the cache (discard, or clear before retry). */
export function useDiscardFailedMessage(channelId: string) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const key = messagesKey(organizationId, channelId);

  return (messageId: string) => {
    queryClient.setQueryData<SerializedMessage[]>(key, (old) =>
      (old ?? []).filter((m) => m.id !== messageId),
    );
  };
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

export function useSendThreadReply(channelId: string, rootMessageId: string) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { content: string; attachmentFileIds?: string[] }) =>
      chatApi.sendMessage({
        organizationId: organizationId!,
        channelId,
        content: args.content,
        rootId: rootMessageId,
        attachmentFileIds: args.attachmentFileIds,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["chat", "threadMessages", organizationId, channelId, rootMessageId],
      });
      queryClient.invalidateQueries({
        queryKey: ["chat", "thread", organizationId, channelId, rootMessageId],
      });
      queryClient.invalidateQueries({ queryKey: ["chat", "threads", organizationId] });
      // The root message's reply count lives in the channel list too.
      queryClient.invalidateQueries({ queryKey: messagesKey(organizationId, channelId) });
    },
  });
}

export function useMarkThreadRead() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (rootMessageId: string) =>
      chatApi.markThreadRead({ organizationId: organizationId!, rootMessageId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "threads", organizationId] });
    },
  });
}

export function useRespondToAgentConfirmation(channelId: string) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { messageId: string; requestId: string; approve: boolean }) =>
      chatApi.respondToAgentConfirmation({
        organizationId: organizationId!,
        channelId,
        messageId: args.messageId,
        requestId: args.requestId,
        decision: args.approve ? AgentConfirmationDecision.APPROVE : AgentConfirmationDecision.DENY,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "approvals", organizationId, channelId] });
      queryClient.invalidateQueries({ queryKey: messagesKey(organizationId, channelId) });
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
    mutationFn: (name: string) => chatApi.createCategory({ organizationId: organizationId!, name }),
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

export function useUpdateChannel(channelId: string) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { name?: string; description?: string }) =>
      chatApi.updateChannel({
        organizationId: organizationId!,
        channelId,
        name: args.name,
        description: args.description,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "channel", organizationId, channelId] });
      queryClient.invalidateQueries({ queryKey: ["chat", "channels", organizationId] });
    },
  });
}

export function useArchiveChannel() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (channelId: string) =>
      chatApi.archiveChannel({ organizationId: organizationId!, channelId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "channels", organizationId] });
    },
  });
}

export function useDeleteChannel() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (channelId: string) =>
      chatApi.deleteChannel({ organizationId: organizationId!, channelId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "channels", organizationId] });
    },
  });
}

export function useAddMembers(channelId: string) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userIds: string[]) =>
      chatApi.addMembers({ organizationId: organizationId!, channelId, userIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "members", organizationId, channelId] });
      queryClient.invalidateQueries({ queryKey: ["chat", "channel", organizationId, channelId] });
    },
  });
}

export function useRemoveMembers(channelId: string) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userIds: string[]) =>
      chatApi.removeMembers({ organizationId: organizationId!, channelId, userIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "members", organizationId, channelId] });
      queryClient.invalidateQueries({ queryKey: ["chat", "channel", organizationId, channelId] });
    },
  });
}

export function useUpdateChannelMember(channelId: string) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      userId: string;
      isMuted?: boolean;
      notificationLevel?: NotificationLevel;
      mutedUntilSeconds?: number;
    }) =>
      chatApi.updateChannelMember({
        organizationId: organizationId!,
        channelId,
        userId: args.userId,
        isMuted: args.isMuted,
        notificationLevel:
          args.notificationLevel !== undefined
            ? notificationLevelToProto(args.notificationLevel)
            : undefined,
        mutedUntil:
          args.mutedUntilSeconds !== undefined
            ? { seconds: BigInt(args.mutedUntilSeconds), nanos: 0 }
            : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "members", organizationId, channelId] });
      queryClient.invalidateQueries({ queryKey: ["chat", "unread", organizationId] });
    },
  });
}

export function useUpdateCategory() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { categoryId: string; name: string }) =>
      chatApi.updateCategory({
        organizationId: organizationId!,
        categoryId: args.categoryId,
        name: args.name,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "categories", organizationId] });
    },
  });
}

export function useDeleteCategory() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (categoryId: string) =>
      chatApi.deleteCategory({ organizationId: organizationId!, categoryId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "categories", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["chat", "channels", organizationId] });
    },
  });
}

export function useMoveChannelToCategory() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { channelId: string; categoryId?: string }) =>
      chatApi.moveChannelToCategory({
        organizationId: organizationId!,
        channelId: args.channelId,
        categoryId: args.categoryId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "channels", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["chat", "categories", organizationId] });
    },
  });
}
