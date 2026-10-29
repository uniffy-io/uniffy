import { MessageAttachments } from "@/features/chat/components/channel/MessageAttachments";
import { useEffect, useRef, useState } from "react";
import { PaperPlaneTilt, X } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageContent } from "@/features/chat/components/channel/MessageContent";
import {
  selectMessagesForChannel,
  selectHasMoreForChannel,
  selectIsChannelLoading,
  selectInitialChannelLoadFailed,
} from "@/features/chat/store/chatMessagesSlice";
import { fetchMessages, sendMessage } from "@/features/chat/store/chatThunks";

export function CallChat({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
  const messages = useAppSelector((s) => selectMessagesForChannel(s, channelId));
  const hasMore = useAppSelector((s) => selectHasMoreForChannel(s, channelId));
  const loading = useAppSelector((s) => selectIsChannelLoading(s, channelId));
  const failed = useAppSelector((s) => selectInitialChannelLoadFailed(s, channelId));
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const lastId = messages.at(-1)?.id;
  useEffect(() => {
    void dispatch(fetchMessages({ channelId }));
    const timer = setInterval(() => {
      const element = scroller.current;
      if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 80)
        void dispatch(fetchMessages({ channelId }));
    }, 20000);
    return () => clearInterval(timer);
  }, [dispatch, channelId]);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [lastId]);
  const send = async () => {
    if (!draft.trim() || sending) return;
    const content = draft;
    setSending(true);
    try {
      await dispatch(sendMessage({ channelId, content })).unwrap();
      setDraft("");
    } catch {
      /* Preserve draft while the shared error pipeline reports failure. */
    } finally {
      setSending(false);
    }
  };
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-surface"
      aria-label="Channel chat"
      data-testid="call-chat"
    >
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex-1">
          <h3 className="text-sm font-medium">Channel chat</h3>
          <p className="text-xs text-muted-foreground">Messages stay here after this call.</p>
        </div>
        <Button variant="ghost" className="size-11" aria-label="Close chat" onClick={onClose}>
          <X size={18} />
        </Button>
      </header>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {hasMore && (
          <Button
            variant="ghost"
            disabled={loading}
            onClick={() => void dispatch(fetchMessages({ channelId, beforeId: messages[0]?.id }))}
          >
            Earlier messages
          </Button>
        )}
        {loading && messages.length === 0 && (
          <p className="text-sm text-muted-foreground">Loading messages...</p>
        )}
        {failed && (
          <Button variant="ghost" onClick={() => void dispatch(fetchMessages({ channelId }))}>
            Retry loading messages
          </Button>
        )}
        <div
          role="log"
          aria-label="Channel messages"
          aria-live="polite"
          aria-relevant="additions text"
          className="space-y-4"
        >
          {messages.map((m) => (
            <article key={m.id} className="break-words text-sm">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                {m.senderName || "Participant"}
              </p>
              <MessageContent content={m.isDeleted ? "Message deleted" : m.content} />
              {!m.isDeleted && organizationId && m.attachments && (
                <MessageAttachments attachments={m.attachments} organizationId={organizationId} />
              )}
            </article>
          ))}
        </div>
      </div>
      <form
        className="flex items-end gap-2 border-t border-border/60 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Textarea
          aria-label="Message channel"
          placeholder="Message channel..."
          value={draft}
          disabled={sending}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button
          type="submit"
          className="size-11 shrink-0"
          disabled={sending || !draft.trim()}
          aria-label="Send message"
        >
          <PaperPlaneTilt size={18} />
        </Button>
      </form>
    </section>
  );
}
