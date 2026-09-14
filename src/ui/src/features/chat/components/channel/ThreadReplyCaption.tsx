import { useEffect, useRef, useState } from "react";
import { ChatText } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { setActiveThread } from "@/features/chat/store/chatThreadsSlice";
import { openThreadPanel } from "@/features/chat/store/chatUiSlice";
import { selectMessageById } from "@/features/chat/store/chatMessagesSlice";
import type { ThreadReplyContext } from "@/features/chat/types";

import { fetchThreadRoot } from "@/features/chat/store/chatThunks";
import { stripMarkdownAndTruncate } from "@/features/search/utils/stripMarkdown";

const PREVIEW_LENGTH = 90;

export function ThreadReplyCaption({
  context,
  channelId,
}: {
  context: ThreadReplyContext;
  channelId: string;
}) {
  const dispatch = useAppDispatch();
  const rootMessage = useAppSelector((state) => selectMessageById(state, context.rootMessageId));

  const [loading, setLoading] = useState(false);
  const pending = useRef<ReturnType<ReturnType<typeof fetchThreadRoot>> | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const preview = stripMarkdownAndTruncate(rootMessage?.content ?? "", PREVIEW_LENGTH);

  const openThread = async () => {
    setLoading(true);
    try {
      const request = dispatch(
        fetchThreadRoot({ channelId, rootMessageId: context.rootMessageId }),
      );
      pending.current = request;
      const result = await request;
      if (!fetchThreadRoot.fulfilled.match(result)) return;
      dispatch(setActiveThread(context.rootMessageId));
      dispatch(openThreadPanel());
    } finally {
      pending.current = null;
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void openThread()}
      disabled={loading}
      className="focus-ring mt-1 flex max-w-full items-center gap-1.5 rounded px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      data-testid={`chat-thread-reply-caption-${context.replyMessageId}`}
    >
      <ChatText size={13} className="shrink-0" />
      <span className="shrink-0">Replied to a thread</span>
      {preview && (
        <>
          <span aria-hidden="true" className="shrink-0 text-subtle-foreground">
            ·
          </span>
          <span className="truncate text-subtle-foreground">{preview}</span>
        </>
      )}
    </button>
  );
}
