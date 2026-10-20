import { useState, useCallback } from "react";
import { Paperclip } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { ChannelSelectList } from "@/features/chat/components/channel/ChannelSelectList";
import { MessageContent } from "@/features/chat/components/channel/MessageContent";
import { forwardMessage, openSelfChat, unarchiveChannel } from "@/features/chat/store/chatThunks";
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
  // The self conversation may not exist yet; it is created only when the forward is sent.
  const [toSelf, setToSelf] = useState(false);
  const [comment, setComment] = useState("");
  const selfDm = useAppSelector((state) =>
    Object.values(state.chatChannels.byId).find(
      (channel) => channel.isSelfDm && !channel.isDeleted,
    ),
  );
  const sourceIsSelfDm = useAppSelector(
    (state) => state.chatChannels.byId[message.channelId]?.isSelfDm === true,
  );
  const [isSending, setIsSending] = useState(false);

  const filterChannel = useCallback(
    (channel: ChatChannel) =>
      channel.id !== message.channelId &&
      !channel.isArchived &&
      !channel.isDeleted &&
      !channel.agentIsRetired,
    [message.channelId],
  );

  const handleSelectChannel = useCallback((channelId: string) => {
    setToSelf(false);
    setTargetChannelId(channelId);
  }, []);

  const handleSelectSelf = useCallback(() => {
    setTargetChannelId(null);
    setToSelf(true);
  }, []);

  const hasTarget = toSelf || !!targetChannelId;
  const restoreSelf = toSelf && selfDm?.isArchived === true;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasTarget || isSending) return;
    setIsSending(true);
    try {
      let channelId = targetChannelId;
      if (toSelf) {
        const channel = await dispatch(openSelfChat()).unwrap();
        if (channel.isArchived) {
          // A newly discovered archive needs explicit consent before restoration.
          if (!restoreSelf || selfDm?.id !== channel.id) return;
          await dispatch(unarchiveChannel(channel.id)).unwrap();
        }
        channelId = channel.id;
      }
      if (!channelId) return;
      await dispatch(
        forwardMessage({
          sourceMessageId: message.id,
          targetChannelId: channelId,
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
                  onSelect={handleSelectChannel}
                  filterChannel={filterChannel}
                  selectedChannelId={targetChannelId}
                  selfConversation={
                    sourceIsSelfDm ? undefined : { selected: toSelf, onSelect: handleSelectSelf }
                  }
                  autoFocus
                />
              </div>
              {restoreSelf && (
                <p role="status" className="mt-2 text-sm text-muted-foreground">
                  Your conversation is archived. Restore it to forward this message.
                </p>
              )}
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
              disabled={!hasTarget || isSending}
              loading={isSending}
              data-testid="chat-forward-submit"
            >
              {restoreSelf ? "Restore and forward" : "Forward"}
            </Button>
          </ModalFooter>
        </form>
      </div>
    </Modal>
  );
}
