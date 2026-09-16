import type { SerializedDraft } from "@features/chat/chatSerializer";

export function draftChannelIds(
  drafts: Record<string, SerializedDraft> | undefined,
  pathname: string,
): Set<string> {
  const channels = new Set<string>();
  for (const draft of Object.values(drafts ?? {})) {
    const draftPath = draft.rootMessageId
      ? `/chat/thread/${draft.rootMessageId}`
      : `/chat/${draft.channelId}`;
    if (pathname !== draftPath) channels.add(draft.channelId);
  }
  return channels;
}
