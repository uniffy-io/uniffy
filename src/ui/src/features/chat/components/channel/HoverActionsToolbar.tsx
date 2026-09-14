import { memo, useState, useCallback, useRef, type ReactNode } from "react";
import { ActionMenu, ActionMenuItem } from "@/components/ui/action-menu";
import {
  ArrowBendDoubleUpRight,
  ArrowBendUpLeft,
  BookmarkSimple,
  ChatText,
  Copy,
  DotsThreeVertical,
  LinkSimple,
  Pencil,
  PushPin,
  Smiley,
  Trash,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useBookmarkToggle } from "@/features/bookmarks";
import { popoverShellClass } from "@/components/ui/popover";
import { cn } from "@/shared/utils/cn";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { openThreadPanel } from "@/features/chat/store/chatUiSlice";
import { setActiveThread } from "@/features/chat/store/chatThreadsSlice";
import { EmojiPicker } from "@/features/chat/components/compose/EmojiPicker";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  pinMessage,
  unpinMessage,
  addReaction,
  removeMessage,
} from "@/features/chat/store/chatThunks";

interface HoverActionsToolbarProps {
  messageId: string;
  channelId: string;
  senderId: string;
  isPinned: boolean;
  canReplyInThread: boolean;
  content: string;
  /** Edit-window policy decision, evaluated when the menu opens; the server is the boundary. */
  isEditAllowed?: () => boolean;
  onQuoteReply?: () => void;
  onEdit?: () => void;
  onForward?: () => void;
  renderAdditionalActions?: (closeMenu: () => void) => ReactNode;
}

function HoverActionsToolbarInner({
  messageId,
  channelId,
  senderId,
  isPinned,
  canReplyInThread,
  content,
  isEditAllowed,
  onQuoteReply,
  onEdit,
  onForward,
  renderAdditionalActions,
}: HoverActionsToolbarProps) {
  const dispatch = useAppDispatch();
  const currentUserId = useAppSelector((state) => state.auth.user?.id);
  const { isMobileOrTablet } = useBreakpoint();
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);

  const isOwnMessage = senderId === currentUserId;

  const messageUrn = `urn:uniffy:content:CHAT_MESSAGE:${messageId}`;
  const {
    isBookmarked,
    toggling: bookmarkToggling,
    toggle: toggleBookmark,
  } = useBookmarkToggle(messageUrn);

  const buttonClass = cn(
    "focus-ring p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted",
    "transition-colors h-11 w-11 lg:h-7 lg:w-7 flex items-center justify-center",
  );

  const handleReplyInThread = useCallback(() => {
    if (!canReplyInThread) return;
    dispatch(setActiveThread(messageId));
    dispatch(openThreadPanel());
  }, [canReplyInThread, dispatch, messageId]);

  const handleTogglePin = useCallback(() => {
    if (isPinned) {
      dispatch(unpinMessage({ channelId, messageId }));
    } else {
      dispatch(pinMessage({ channelId, messageId }));
    }
  }, [dispatch, channelId, messageId, isPinned]);

  const handleQuoteReply = useCallback(() => {
    onQuoteReply?.();
  }, [onQuoteReply]);

  const handleEmojiSelect = useCallback(
    (emoji: string) => {
      dispatch(addReaction({ channelId, messageId, emoji }));
      setShowEmojiPicker(false);
    },
    [dispatch, channelId, messageId],
  );

  const handleCopyText = useCallback(() => {
    navigator.clipboard.writeText(content);
    setShowMoreMenu(false);
  }, [content]);

  const handleCopyLink = useCallback(() => {
    const permalink = `${window.location.origin}/chat/${channelId}#${messageId}`;
    navigator.clipboard.writeText(permalink);
    setShowMoreMenu(false);
  }, [channelId, messageId]);

  const handleToggleSave = useCallback(() => {
    toggleBookmark();
    setShowMoreMenu(false);
  }, [toggleBookmark]);

  const handleEdit = useCallback(() => {
    setShowMoreMenu(false);
    onEdit?.();
  }, [onEdit]);

  const handleDelete = useCallback(() => {
    setShowMoreMenu(false);
    setShowDeleteConfirm(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await dispatch(removeMessage({ channelId, messageId })).unwrap();
      setShowDeleteConfirm(false);
    } finally {
      setIsDeleting(false);
    }
    // The deps below ARE read in the body; oxlint's memo analysis misses reads
    // inside try/finally blocks and object-literal call arguments.
    // eslint-disable-next-line react/react-compiler
  }, [dispatch, channelId, messageId]);

  return (
    <div
      className={cn(
        popoverShellClass,
        "absolute top-0 lg:-top-4 right-4 flex items-center",
        showMoreMenu || showEmojiPicker
          ? "opacity-100 z-50"
          : "opacity-100 lg:opacity-0 lg:group-hover:opacity-100 focus-within:opacity-100 z-10 transition-opacity duration-150",
      )}
      data-testid={`chat-message-actions-${messageId}`}
    >
      {!isMobileOrTablet && (
        <>
          <button
            ref={emojiButtonRef}
            className={buttonClass}
            title="Add reaction"
            onClick={() => setShowEmojiPicker((prev) => !prev)}
            data-testid={`chat-message-react-button-${messageId}`}
          >
            <Smiley size={16} />
          </button>

          {canReplyInThread && (
            <button
              className={buttonClass}
              title="Reply in thread"
              onClick={handleReplyInThread}
              data-testid={`chat-message-thread-button-${messageId}`}
            >
              <ChatText size={16} />
            </button>
          )}

          <button
            className={buttonClass}
            title={isPinned ? "Unpin message" : "Pin message"}
            onClick={handleTogglePin}
            data-testid={`chat-message-pin-button-${messageId}`}
            data-state={isPinned ? "pinned" : "unpinned"}
          >
            <PushPin size={16} weight={isPinned ? "fill" : "regular"} />
          </button>

          <button
            className={buttonClass}
            title="Quote reply"
            onClick={handleQuoteReply}
            data-testid={`chat-message-reply-button-${messageId}`}
          >
            <ArrowBendUpLeft size={16} />
          </button>

          {onForward && (
            <button
              className={buttonClass}
              title="Forward"
              onClick={onForward}
              data-testid={`chat-message-forward-button-${messageId}`}
            >
              <ArrowBendDoubleUpRight size={16} />
            </button>
          )}
        </>
      )}

      {showEmojiPicker && (
        <EmojiPicker
          anchorRef={isMobileOrTablet ? moreButtonRef : emojiButtonRef}
          onSelect={handleEmojiSelect}
          onClose={() => setShowEmojiPicker(false)}
        />
      )}

      <div className="relative">
        <button
          ref={moreButtonRef}
          className={buttonClass}
          title="More actions"
          aria-haspopup="menu"
          aria-expanded={showMoreMenu}
          onClick={() => {
            setCanEdit(isEditAllowed?.() ?? false);
            setShowMoreMenu((prev) => !prev);
          }}
          data-testid={`chat-message-more-button-${messageId}`}
          data-state={showMoreMenu ? "open" : "closed"}
        >
          <DotsThreeVertical size={16} />
        </button>

        <ActionMenu
          label="Message actions"
          open={showMoreMenu}
          onClose={() => setShowMoreMenu(false)}
          triggerRef={moreButtonRef}
          className={renderAdditionalActions ? "w-72" : "w-52"}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            data-testid={`chat-message-more-menu-${messageId}`}
          >
            {isMobileOrTablet && (
              <div className="mb-1 border-b border-border/60 pb-1">
                <ActionMenuItem
                  role="menuitem"

                  onClick={() => {
                    setShowMoreMenu(false);
                    setShowEmojiPicker(true);
                  }}
                >
                  <Smiley size={16} />
                  <span>Add reaction</span>
                </ActionMenuItem>
                {canReplyInThread && (
                  <ActionMenuItem
                    role="menuitem"
                    onClick={() => {
                      setShowMoreMenu(false);
                      handleReplyInThread();
                    }}
                  >
                    <ChatText size={16} />
                    <span>Reply in thread</span>
                  </ActionMenuItem>
                )}
                <ActionMenuItem
                  role="menuitem"

                  onClick={() => {
                    setShowMoreMenu(false);
                    handleTogglePin();
                  }}
                >
                  <PushPin size={16} weight={isPinned ? "fill" : "regular"} />
                  <span>{isPinned ? "Unpin message" : "Pin message"}</span>
                </ActionMenuItem>
                <ActionMenuItem
                  role="menuitem"

                  onClick={() => {
                    setShowMoreMenu(false);
                    handleQuoteReply();
                  }}
                >
                  <ArrowBendUpLeft size={16} />
                  <span>Quote reply</span>
                </ActionMenuItem>
                {onForward && (
                  <ActionMenuItem
                    role="menuitem"

                    onClick={() => {
                      setShowMoreMenu(false);
                      onForward();
                    }}
                  >
                    <ArrowBendDoubleUpRight size={16} />
                    <span>Forward</span>
                  </ActionMenuItem>
                )}
              </div>
            )}
            <ActionMenuItem
              role="menuitem"

              onClick={handleCopyText}
              data-testid={`chat-message-copy-text-${messageId}`}
            >
              <Copy size={14} />
              <span>Copy text</span>
            </ActionMenuItem>
            <ActionMenuItem
              role="menuitem"

              onClick={handleCopyLink}
              data-testid={`chat-message-copy-link-${messageId}`}
            >
              <LinkSimple size={14} />
              <span>Copy link</span>
            </ActionMenuItem>
            <ActionMenuItem
              role="menuitem"

              onClick={handleToggleSave}
              disabled={bookmarkToggling}
              data-testid={`chat-message-save-button-${messageId}`}
              data-state={isBookmarked ? "saved" : "unsaved"}
            >
              <BookmarkSimple size={14} weight={isBookmarked ? "fill" : "regular"} />
              <span>{isBookmarked ? "Remove from saved" : "Save message"}</span>
            </ActionMenuItem>
            {renderAdditionalActions && (
              <div className="mt-1 border-t border-border/60 pt-1">
                {renderAdditionalActions(() => setShowMoreMenu(false))}
              </div>
            )}
            {isOwnMessage && (
              <>
                <div className="my-1 border-t border-border" />
                {canEdit && (
                  <ActionMenuItem
                    role="menuitem"

                    onClick={handleEdit}
                    data-testid={`chat-message-edit-button-${messageId}`}
                  >
                    <Pencil size={14} />
                    <span>Edit message</span>
                  </ActionMenuItem>
                )}
                <ActionMenuItem
                  role="menuitem"
                  destructive
                  onClick={handleDelete}
                  data-testid={`chat-message-delete-button-${messageId}`}
                >
                  <Trash size={14} />
                  <span>Delete message</span>
                </ActionMenuItem>
              </>
            )}
          </div>
        </ActionMenu>
      </div>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleConfirmDelete}
        title="Delete message"
        message="Are you sure you want to delete this message? This action cannot be undone."
        confirmLabel="Delete message"
        variant="danger"
        loading={isDeleting}
      />
    </div>
  );
}

export const HoverActionsToolbar = memo(HoverActionsToolbarInner);
