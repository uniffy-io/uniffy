import { ChatText } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { setActiveThread } from "@/features/chat/store/chatThreadsSlice";
import { openThreadPanel } from "@/features/chat/store/chatUiSlice";
import { selectMessageById } from "@/features/chat/store/chatMessagesSlice";
import type { ThreadReplyContext } from "@/features/chat/types";

const PREVIEW_LENGTH = 90;

/**
 * Marks a channel message that was posted alongside a thread reply, and opens
 * that thread. Both rows live in the same channel, so the root message is
 * normally already loaded; without it the caption drops the preview rather
 * than fetching, since it is a label, not content.
 */
export function ThreadReplyCaption({ context }: { context: ThreadReplyContext }) {
  const dispatch = useAppDispatch();
  const rootMessage = useAppSelector((state) => selectMessageById(state, context.rootMessageId));

  const preview = rootMessage?.content.replace(/\s+/g, " ").trim().slice(0, PREVIEW_LENGTH) ?? "";

  return (
    <button
      type="button"
      onClick={() => {
        dispatch(setActiveThread(context.rootMessageId));
        dispatch(openThreadPanel());
      }}
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
