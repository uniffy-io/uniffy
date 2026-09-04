import { memo, useCallback, useMemo } from "react";
import { ArrowBendDoubleUpRight, Hash, LockSimple } from "@phosphor-icons/react";
import { useAppDispatch } from "@/app/hooks";
import { jumpToChannelMessage } from "@/features/chat/store/chatThunks";
import { MessageContent } from "@/features/chat/components/channel/MessageContent";
import { MessageAttachments } from "@/features/chat/components/channel/MessageAttachments";
import { formatMessageTimestamp } from "@/features/chat/utils/messageTime";
import { cn } from "@/shared/utils/cn";
import type { ForwardContext } from "@/features/chat/types";

interface ForwardedMessageCardProps {
  context?: ForwardContext;
  messageId: string;
  organizationId: string | null;
}

function ForwardedMessageCardInner({
  context,
  messageId,
  organizationId,
}: ForwardedMessageCardProps) {
  const dispatch = useAppDispatch();

  const handleJumpToSource = useCallback(() => {
    if (!context) return;
    dispatch(
      jumpToChannelMessage({
        channelId: context.sourceChannelId,
        messageId: context.sourceMessageId,
      }),
    );
  }, [dispatch, context]);

  const attachments = useMemo(
    () =>
      (context?.attachments ?? []).map((a) => ({
        id: a.fileId,
        fileId: a.fileId,
        filename: a.filename,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
      })),
    [context?.attachments],
  );

  if (!context) {
    return (
      <div
        className={cn(
          "mt-1 max-w-[560px] rounded-r-lg border-l-2 border-muted-foreground/30",
          "bg-muted/20 px-3 py-2",
        )}
        data-testid={`chat-message-forwarded-restricted-${messageId}`}
      >
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <LockSimple size={13} className="shrink-0" />
          <span>Forwarded message unavailable</span>
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground/70">
          You don&apos;t have access to the original message.
        </p>
      </div>
    );
  }

  const hasContent = context.content.trim().length > 0;

  return (
    <div
      className={cn(
        "mt-1 max-w-[560px] rounded-r-lg border-l-2 border-primary/40",
        "bg-muted/20 pl-3 pr-3 py-2",
      )}
      data-testid={`chat-message-forwarded-card-${messageId}`}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ArrowBendDoubleUpRight size={12} className="shrink-0 text-primary/60" />
        <span className="shrink-0">Forwarded from</span>
        <button
          type="button"
          onClick={handleJumpToSource}
          className="inline-flex items-center gap-0.5 min-w-0 font-medium text-foreground/80 hover:text-foreground hover:underline cursor-pointer"
          data-testid={`chat-message-forwarded-source-link-${messageId}`}
        >
          <Hash size={11} className="shrink-0" />
          <span className="truncate">{context.sourceChannelName}</span>
        </button>
      </div>

      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-[13px] font-semibold text-foreground">{context.senderName}</span>
        <span className="text-[11px] text-subtle-foreground">
          {formatMessageTimestamp(context.createdAt)}
        </span>
      </div>

      {hasContent && <MessageContent content={context.content} />}

      {attachments.length > 0 && organizationId && (
        <MessageAttachments attachments={attachments} organizationId={organizationId} />
      )}
    </div>
  );
}

export const ForwardedMessageCard = memo(ForwardedMessageCardInner);
