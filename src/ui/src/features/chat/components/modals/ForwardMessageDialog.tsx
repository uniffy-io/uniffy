import { useState, useCallback } from "react";
import { Paperclip, X } from "@phosphor-icons/react";
import { useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ChannelSelectList } from "@/features/chat/components/channel/ChannelSelectList";
import { MessageContent } from "@/features/chat/components/channel/MessageContent";
import { forwardMessage } from "@/features/chat/store/chatThunks";
import { formatMessageTimestamp } from "@/features/chat/utils/messageTime";
import { cn } from "@/shared/utils/cn";
import type { ChatChannel, ChatMessage } from "@/features/chat/types";

interface ForwardMessageDialogProps {
  message: ChatMessage;
  senderName: string;
  onClose: () => void;
}

export function ForwardMessageDialog({ message, senderName, onClose }: ForwardMessageDialogProps) {
  const dispatch = useAppDispatch();
  const [targetChannelId, setTargetChannelId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [isSending, setIsSending] = useState(false);

  const filterChannel = useCallback(
    (channel: ChatChannel) =>
      channel.id !== message.channelId &&
      !channel.isArchived &&
      !channel.isDeleted &&
      !channel.agentIsRetired,
    [message.channelId],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetChannelId || isSending) return;
    setIsSending(true);
    try {
      await dispatch(
        forwardMessage({
          sourceMessageId: message.id,
          targetChannelId,
          comment: comment.trim(),
        }),
      ).unwrap();
      onClose();
    } catch {
      // The rejected thunk already surfaced a toast; stay open so the user can retry.
    } finally {
      setIsSending(false);
    }
  };

  const attachmentCount = message.attachments?.length ?? 0;
  const previewContent = message.content.trim();

  return (
    <Modal onClose={onClose} closeDisabled={isSending} maxWidth="max-w-md">
      <div data-testid={`chat-forward-dialog-${message.id}`}>
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <h2 className="text-lg font-semibold text-foreground">Forward message</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSending}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            data-testid="chat-forward-close"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="px-6 py-3 space-y-4">
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-semibold text-foreground truncate">
                  {senderName}
                </span>
                <span className="text-[11px] text-muted-foreground/60 shrink-0">
                  {formatMessageTimestamp(message.createdAt)}
                </span>
              </div>
              {previewContent ? (
                <MessageContent
                  content={previewContent}
                  compactMentions
                  className="!text-sm line-clamp-3 [&_p]:!m-0"
                />
              ) : (
                <p className="text-sm text-muted-foreground italic">Forwarded message</p>
              )}
              {attachmentCount > 0 && (
                <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Paperclip size={12} />
                  {attachmentCount === 1 ? "1 attachment" : `${attachmentCount} attachments`}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Forward to</label>
              <div
                className={cn(
                  "flex flex-col h-56 rounded-lg border border-input overflow-hidden",
                  isSending && "pointer-events-none opacity-60",
                )}
              >
                <ChannelSelectList
                  onSelect={setTargetChannelId}
                  filterChannel={filterChannel}
                  selectedChannelId={targetChannelId}
                  autoFocus
                />
              </div>
            </div>

            <div>
              <textarea
                placeholder="Add a comment (optional)"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={isSending}
                rows={2}
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                data-testid="chat-forward-comment-input"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={isSending}
              data-testid="chat-forward-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!targetChannelId || isSending}
              loading={isSending}
              data-testid="chat-forward-submit"
            >
              Forward
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
