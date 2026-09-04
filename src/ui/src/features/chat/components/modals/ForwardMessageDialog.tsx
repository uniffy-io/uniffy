import { useState, useCallback } from "react";
import { Paperclip } from "@phosphor-icons/react";
import { useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
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
        <ModalHeader title="Forward message" />

        <form onSubmit={handleSubmit}>
          <ModalBody>
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-semibold text-foreground truncate">
                  {senderName}
                </span>
                <span className="text-[11px] text-subtle-foreground shrink-0">
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
              <label className="block text-sm text-muted-foreground mb-1">Forward to</label>
              <div
                className={cn(
                  "flex flex-col h-56 rounded-lg border border-border overflow-hidden",
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
              <label className="block text-sm text-muted-foreground mb-1">Comment (optional)</label>
              <Textarea
                placeholder="Add a comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={isSending}
                rows={2}
                data-testid="chat-forward-comment-input"
              />
            </div>
          </ModalBody>

          <ModalFooter>
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
          </ModalFooter>
        </form>
      </div>
    </Modal>
  );
}
