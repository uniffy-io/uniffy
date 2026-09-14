export const MESSAGE_WINDOW_SIZE = 50;

export type MessageWindowCursor = { aroundId?: string; beforeId?: string; afterId?: string };
type MessagePage<Message> = { messages: Message[]; hasMore: boolean };

export function messageWindowOptions<Message extends { id: string }>(
  organizationId: string,
  channelId: string,
  entryKey: string,
  target: string,
  fetchPage: (cursor: MessageWindowCursor, signal: AbortSignal) => Promise<MessagePage<Message>>,
) {
  return {
    maxPages: 10,
    queryKey: ["chat", "messages", organizationId, channelId, "window", entryKey, target],
    initialPageParam: { aroundId: target } as MessageWindowCursor,
    queryFn: async ({
      pageParam,
      signal,
    }: {
      pageParam: MessageWindowCursor;
      signal: AbortSignal;
    }) => {
      const page = await fetchPage(pageParam, signal);
      const targetIndex = page.messages.findIndex((message) => message.id === target);
      return {
        messages: page.messages,
        hasOlder: pageParam.afterId ? true : page.hasMore,
        hasNewer: pageParam.afterId
          ? page.hasMore
          : pageParam.beforeId
            ? true
            : targetIndex >= MESSAGE_WINDOW_SIZE / 2,
      };
    },
    getNextPageParam: (page: {
      messages: Message[];
      hasOlder: boolean;
    }): MessageWindowCursor | undefined =>
      page.hasOlder && page.messages.length
        ? { beforeId: page.messages[page.messages.length - 1].id }
        : undefined,
    getPreviousPageParam: (page: {
      messages: Message[];
      hasNewer: boolean;
    }): MessageWindowCursor | undefined =>
      page.hasNewer && page.messages.length ? { afterId: page.messages[0].id } : undefined,
  };
}
