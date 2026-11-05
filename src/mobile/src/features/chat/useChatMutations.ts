import { getAuthGeneration } from "@core/auth/sessionEvents";
import { localSend, mergeSendRows } from "@features/chat/sendState";
import { pendingSends, forgetPendingSend } from "@features/chat/pendingSends";
import { deliverSend } from "@features/chat/sendDelivery";
import { randomUUID } from "expo-crypto";
import type { UnreadMap } from "@features/chat/unreadCounts";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AgentConfirmationDecision } from "@uniffy/proto/chat/v1/chat_pb";
import { SubjectType } from "@uniffy/proto/common/v1/common_pb";
import { useAuth } from "@core/providers/AuthContext";
import { chatApi } from "@features/chat/chatApi";
import {
  channelTypeToProto,
  notificationLevelToProto,
  draftKey,
  messageToPlain,
  type ChannelType,
  type NotificationLevel,
  type SerializedMessage,
  type SerializedDraft,
} from "@features/chat/chatSerializer";

export function messagesKey(orgId: string | null, channelId: string) {
  return ["chat", "messages", orgId, channelId];
}

export function draftsKey(orgId: string | null) {
  return ["chat", "drafts", orgId];
}

export function agentFoldersKey(orgId: string | null) {
  return ["chat", "agentFolders", orgId];
}

export function upsertDraftInCache(
  queryClient: QueryClient,
  orgId: string | null,
  draft: SerializedDraft,
) {
  queryClient.setQueryData<Record<string, SerializedDraft>>(draftsKey(orgId), (old) => ({
    ...old,
    [draftKey(draft.channelId, draft.rootMessageId)]: draft,
  }));
}

export function removeDraftFromCache(queryClient: QueryClient, orgId: string | null, key: string) {
  queryClient.setQueryData<Record<string, SerializedDraft>>(draftsKey(orgId), (old) => {
    if (!old || !(key in old)) return old;
    const next = { ...old };
    delete next[key];
    return next;
  });
}

export function useSendMessage(channelId: string) {
  const { organizationId, user } = useAuth();
  const queryClient = useQueryClient();
  const key = messagesKey(organizationId, channelId);

  return useMutation({
    mutationFn: (args: {
      content: string;
      attachmentFileIds?: string[];
      replyToId?: string;
      clientMessageId?: string;
      onPrepared?: () => void;
    }) => {
      args.clientMessageId ??= randomUUID();
      const { onPrepared, ...request } = args;
      return deliverSend(user!.id, organizationId!, { ...request, channelId }, (pending) => {
        args.clientMessageId = pending.request.clientMessageId;
        queryClient.setQueryData<SerializedMessage[]>(key, (old) =>
          mergeSendRows(old ?? [], [
            localSend(pending.request, user!.id, false, user?.fullName || user?.username),
          ]),
        );
        onPrepared?.();
      });
    },
    onMutate: async () => {
      const generation = getAuthGeneration();
      await queryClient.cancelQueries({ queryKey: key });
      return { generation };
    },
    // A failed send keeps its text on screen, flagged for retry or discard;
    // without this the composer has already been cleared and the message is gone.
    onError: (_err, args, context) => {
      if (context?.generation !== getAuthGeneration()) return;
      const failed = localSend(
        { ...args, channelId },
        user?.id ?? "",
        true,
        user?.fullName || user?.username,
      );
      queryClient.setQueryData<SerializedMessage[]>(key, (old) => {
        if (
          old?.some(
            (row) =>
              row.clientMessageId === args.clientMessageId && row.metadata.optimistic !== "1",
          )
        )
          return old;
        return [failed, ...(old ?? []).filter((row) => row.id !== failed.id)];
      });
    },
    // The live stream echoes the same message, so it may already be here.
    onSuccess: (res, _args, context) => {
      if (context?.generation !== getAuthGeneration()) return;
      const real = res.message ? messageToPlain(res.message) : null;
      if (!real) return;
      queryClient.setQueryData<SerializedMessage[]>(key, (old) => {
        if (!old) return [real];
        const remaining = old.filter(
          (m) => m.clientMessageId !== real.clientMessageId || m.metadata.optimistic !== "1",
        );
        return remaining.some((m) => m.id === real.id) ? remaining : [real, ...remaining];
      });
    },
  });
}

/** Remove a failed optimistic message from the cache (discard, or clear before retry). */
export function useDiscardFailedMessage(channelId: string, rootId?: string) {
  const { organizationId, user } = useAuth();
  const queryClient = useQueryClient();
  const key = messagesKey(organizationId, channelId);
  const targetKey = rootId ? ["chat", "threadMessages", organizationId, channelId, rootId] : key;
  const discard = useMutation({
    mutationFn: async (messageId: string) => {
      const record = (await pendingSends(user!.id, organizationId!)).find(
        (row) => `optimistic-${row.request.clientMessageId}` === messageId,
      );
      if (record) await forgetPendingSend(record);
      return messageId;
    },
    onSuccess: (messageId) =>
      queryClient.setQueryData<SerializedMessage[]>(targetKey, (old) =>
        (old ?? []).filter((row) => row.id !== messageId),
      ),
  });
  return discard.mutate;
}

export function useRetryFailedMessage() {
  const { organizationId, user } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (messageId: string) => {
      const generation = getAuthGeneration();
      const record = (await pendingSends(user!.id, organizationId!)).find(
        (row) => `optimistic-${row.request.clientMessageId}` === messageId,
      );
      if (!record || generation !== getAuthGeneration()) return;
      const request = record.request;
      const key = request.rootId
        ? ["chat", "threadMessages", organizationId, request.channelId, request.rootId]
        : messagesKey(organizationId, request.channelId);
      const response = await deliverSend(user!.id, organizationId!, request);
      if (generation === getAuthGeneration() && response.message)
        client.setQueryData<SerializedMessage[]>(key, (old) =>
          mergeSendRows(old ?? [], [messageToPlain(response.message!)]),
        );
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

export function useSendThreadReply(channelId: string, rootMessageId: string) {
  const { organizationId, user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      content: string;
      attachmentFileIds?: string[];
      alsoSendToChannel?: boolean;
      clientMessageId?: string;
      onPrepared?: () => void;
    }) => {
      args.clientMessageId ??= randomUUID();
      const { onPrepared, ...request } = args;
      return deliverSend(
        user!.id,
        organizationId!,
        { ...request, channelId, rootId: rootMessageId },
        (pending) => {
          args.clientMessageId = pending.request.clientMessageId;
          queryClient.setQueryData<SerializedMessage[]>(
            ["chat", "threadMessages", organizationId, channelId, rootMessageId],
            (old) => mergeSendRows(old ?? [], [localSend(pending.request, user!.id, false)]),
          );
          onPrepared?.();
        },
      );
    },
    onMutate: () => ({ generation: getAuthGeneration() }),
    onError: (_err, args, context) => {
      if (context?.generation !== getAuthGeneration()) return;
      const key = ["chat", "threadMessages", organizationId, channelId, rootMessageId];
      queryClient.setQueryData<SerializedMessage[]>(key, (old) =>
        mergeSendRows(old ?? [], [
          localSend({ ...args, channelId, rootId: rootMessageId }, user!.id, true),
        ]),
      );
    },
    onSuccess: (response, _args, context) => {
      if (context?.generation !== getAuthGeneration()) return;
      if (response.message)
        queryClient.setQueryData<SerializedMessage[]>(
          ["chat", "threadMessages", organizationId, channelId, rootMessageId],
          (old) => mergeSendRows(old ?? [], [messageToPlain(response.message!)]),
        );
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

export function useMarkChannelUnread(channelId: string) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (messageId: string) =>
      chatApi.markChannelUnread({
        organizationId: organizationId!,
        channelId,
        messageId,
      }),
    onSuccess: (res) => {
      queryClient.setQueryData<UnreadMap>(["chat", "unread", organizationId], (prev) => ({
        ...prev,
        [channelId]: {
          ...prev?.[channelId],
          unread: res.unreadCount,
          mentions: res.mentionCount,
          lastReadMessageId: res.lastReadMessageId,
          firstUnreadMessageId: res.firstUnreadMessageId,
        },
      }));
    },
  });
}

/**
 * Autosave draft mutations patch the cache optimistically and stay silent on
 * error: a failed save keeps the optimistic entry and the next debounce
 * retries, so surfacing anything would only spam flaky-network sessions.
 */
export function useSaveDraft() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { channelId: string; rootMessageId?: string; content: string }) =>
      chatApi.saveDraft({
        organizationId: organizationId!,
        channelId: args.channelId,
        rootMessageId: args.rootMessageId,
        content: args.content,
      }),
    onMutate: (args) => {
      upsertDraftInCache(queryClient, organizationId, {
        channelId: args.channelId,
        rootMessageId: args.rootMessageId ?? null,
        content: args.content,
        updatedAt: new Date().toISOString(),
      });
    },
  });
}

export function useDeleteDraft() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { channelId: string; rootMessageId?: string }) =>
      chatApi.deleteDraft({
        organizationId: organizationId!,
        channelId: args.channelId,
        rootMessageId: args.rootMessageId,
      }),
    onMutate: (args) => {
      removeDraftFromCache(
        queryClient,
        organizationId,
        draftKey(args.channelId, args.rootMessageId),
      );
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

/** Find or create the viewer's own conversation; resolves to its channel id. */
export function useOpenSelfChat() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<string> => {
      const res = await chatApi.openSelfChat({ organizationId: organizationId! });
      return res.channel?.id ?? "";
    },
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

function useAgentFolderMutation<TArgs>(
  mutationFn: (args: TArgs) => Promise<unknown>,
  { touchesChannels = false }: { touchesChannels?: boolean } = {},
) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentFoldersKey(organizationId) });
      if (touchesChannels) {
        queryClient.invalidateQueries({ queryKey: ["chat", "channels", organizationId] });
        queryClient.invalidateQueries({ queryKey: ["chat", "agentChats", organizationId] });
      }
    },
  });
}

export function useCreateAgentFolder() {
  const { organizationId } = useAuth();
  return useAgentFolderMutation((name: string) =>
    chatApi.createAgentFolder({ organizationId: organizationId!, name }),
  );
}

export function useRenameAgentFolder() {
  const { organizationId } = useAuth();
  return useAgentFolderMutation((args: { folderId: string; name: string }) =>
    chatApi.renameAgentFolder({ organizationId: organizationId!, ...args }),
  );
}

/** The chats inside are kept; they move back to the unfiled root. */
export function useDeleteAgentFolder() {
  const { organizationId } = useAuth();
  return useAgentFolderMutation(
    (folderId: string) => chatApi.deleteAgentFolder({ organizationId: organizationId!, folderId }),
    { touchesChannels: true },
  );
}

export function useSetAgentChatFolder() {
  const { organizationId } = useAuth();
  return useAgentFolderMutation(
    (args: { channelId: string; folderId?: string }) =>
      chatApi.setAgentChatFolder({ organizationId: organizationId!, ...args }),
    { touchesChannels: true },
  );
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

/** Agent DMs are renamed via custom_name, not the channel's own name field. */
export function useRenameAgentChat(channelId: string) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (customName: string) =>
      chatApi.renameAgentChat({
        organizationId: organizationId!,
        channelId,
        customName,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "channel", organizationId, channelId] });
      queryClient.invalidateQueries({ queryKey: ["chat", "channels", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["chat", "agentChats", organizationId] });
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
      queryClient.invalidateQueries({ queryKey: ["chat", "archived-channels", organizationId] });
    },
  });
}

export function useUnarchiveChannel() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (channelId: string) =>
      chatApi.unarchiveChannel({ organizationId: organizationId!, channelId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "channels", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["chat", "archived-channels", organizationId] });
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

export type ChatMemberSubject = { kind: "USER" | "AGENT"; id: string };

function toProtoSubjects(subjects: ChatMemberSubject[]) {
  return subjects.map((s) => ({
    type: s.kind === "AGENT" ? SubjectType.AGENT : SubjectType.USER,
    id: s.id,
  }));
}

export function useAddMembers(channelId: string) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (subjects: ChatMemberSubject[]) =>
      chatApi.addMembers({
        organizationId: organizationId!,
        channelId,
        subjects: toProtoSubjects(subjects),
      }),
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
    mutationFn: (subjects: ChatMemberSubject[]) =>
      chatApi.removeMembers({
        organizationId: organizationId!,
        channelId,
        subjects: toProtoSubjects(subjects),
      }),
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
