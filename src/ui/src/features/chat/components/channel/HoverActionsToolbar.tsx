import { memo, useState, useCallback, useRef, useEffect } from "react";
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
import { cn } from "@/shared/utils/cn";
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
  content: string;
  /** Edit-window policy decision, evaluated when the menu opens; the server is the boundary. */
  isEditAllowed?: () => boolean;
  onQuoteReply?: () => void;
  onEdit?: () => void;
  onForward?: () => void;
}

function HoverActionsToolbarInner({
  messageId,
  channelId,
  senderId,
  isPinned,
  content,
  isEditAllowed,
  onQuoteReply,
  onEdit,
  onForward,
}: HoverActionsToolbarProps) {
  const dispatch = useAppDispatch();
  const currentUserId = useAppSelector((state) => state.auth.user?.id);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);

  const isOwnMessage = senderId === currentUserId;

  const messageUrn = `urn:uniffy:content:CHAT_MESSAGE:${messageId}`;
  const {
    isBookmarked,
    toggling: bookmarkToggling,
    toggle: toggleBookmark,
  } = useBookmarkToggle(messageUrn);

  useEffect(() => {
    if (!showMoreMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowMoreMenu(false);
    };

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEsc);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [showMoreMenu]);

  const buttonClass = cn(
    "p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted",
    "transition-colors h-7 w-7 flex items-center justify-center",
  );

  const handleReplyInThread = useCallback(() => {
    dispatch(setActiveThread(messageId));
    dispatch(openThreadPanel());
  }, [dispatch, messageId]);

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

  const menuItemClass = cn(
    "flex items-center gap-2 px-3 py-1.5 text-sm text-foreground",
    "hover:bg-muted cursor-pointer w-full text-left",
  );

  return (
    <div
      className={cn(
        "absolute -top-4 right-4 flex items-center",
        "bg-card border border-border rounded-lg shadow-md",
        showMoreMenu || showEmojiPicker
          ? "opacity-100 z-50"
          : "opacity-0 group-hover:opacity-100 z-10 transition-opacity duration-150",
      )}
      data-testid={`chat-message-actions-${messageId}`}
    >
      <button
        ref={emojiButtonRef}
        className={buttonClass}
        title="Add reaction"
        onClick={() => setShowEmojiPicker((prev) => !prev)}
        data-testid={`chat-message-react-button-${messageId}`}
      >
        <Smiley size={16} />
      </button>
      {showEmojiPicker && (
        <EmojiPicker
          anchorRef={emojiButtonRef}
          onSelect={handleEmojiSelect}
          onClose={() => setShowEmojiPicker(false)}
        />
      )}

      <button
        className={buttonClass}
        title="Reply in thread"
        onClick={handleReplyInThread}
        data-testid={`chat-message-thread-button-${messageId}`}
      >
        <ChatText size={16} />
      </button>

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

      <div className="relative" ref={moreMenuRef}>
        <button
          className={buttonClass}
          title="More actions"
          onClick={() => {
            setCanEdit(isEditAllowed?.() ?? false);
            setShowMoreMenu((prev) => !prev);
          }}
          data-testid={`chat-message-more-button-${messageId}`}
          data-state={showMoreMenu ? "open" : "closed"}
        >
          <DotsThreeVertical size={16} />
        </button>

        {showMoreMenu && (
          <div
            className={cn(
              "absolute top-full right-0 mt-1 z-[60]",
              "bg-card border border-border rounded-lg shadow-lg py-1",
              "min-w-[160px]",
            )}
            onMouseDown={(e) => e.stopPropagation()}
            data-testid={`chat-message-more-menu-${messageId}`}
          >
            <button
              className={menuItemClass}
              onClick={handleCopyText}
              data-testid={`chat-message-copy-text-${messageId}`}
            >
              <Copy size={14} />
              <span>Copy text</span>
            </button>
            <button
              className={menuItemClass}
              onClick={handleCopyLink}
              data-testid={`chat-message-copy-link-${messageId}`}
            >
              <LinkSimple size={14} />
              <span>Copy link</span>
            </button>
            <button
              className={menuItemClass}
              onClick={handleToggleSave}
              disabled={bookmarkToggling}
              data-testid={`chat-message-save-button-${messageId}`}
              data-state={isBookmarked ? "saved" : "unsaved"}
            >
              <BookmarkSimple size={14} weight={isBookmarked ? "fill" : "regular"} />
              <span>{isBookmarked ? "Remove from saved" : "Save message"}</span>
            </button>
            {isOwnMessage && (
              <>
                <div className="my-1 border-t border-border" />
                {canEdit && (
                  <button
                    className={menuItemClass}
                    onClick={handleEdit}
                    data-testid={`chat-message-edit-button-${messageId}`}
                  >
                    <Pencil size={14} />
                    <span>Edit message</span>
                  </button>
                )}
                <button
                  className={cn(menuItemClass, "text-red-500 hover:text-red-500")}
                  onClick={handleDelete}
                  data-testid={`chat-message-delete-button-${messageId}`}
                >
                  <Trash size={14} />
                  <span>Delete message</span>
                </button>
              </>
            )}
          </div>
        )}
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
