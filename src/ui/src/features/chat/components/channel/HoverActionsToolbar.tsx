import { useState, useCallback, useRef, useEffect } from 'react';
import {
  ArrowBendUpLeft,
  ChatText,
  Copy,
  DotsThreeVertical,
  LinkSimple,
  Pencil,
  PushPin,
  Smiley,
  Trash,
} from '@phosphor-icons/react';
import { useAppDispatch } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { openThreadPanel } from '@/features/chat/store/chatUiSlice';
import { setActiveThread } from '@/features/chat/store/chatThreadsSlice';
import { EmojiPicker } from '@/features/chat/components/compose/EmojiPicker';
import { CURRENT_USER_ID } from '@/features/chat/mock/mockMembers';

interface HoverActionsToolbarProps {
  messageId: string;
  channelId: string;
  senderId: string;
  isPinned: boolean;
  content: string;
  onQuoteReply?: (content: string, senderName: string) => void;
}

export function HoverActionsToolbar({
  messageId,
  channelId,
  senderId,
  isPinned,
  content,
  onQuoteReply,
}: HoverActionsToolbarProps) {
  const dispatch = useAppDispatch();
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);

  const isOwnMessage = senderId === CURRENT_USER_ID;

  // Close more menu on click outside
  useEffect(() => {
    if (!showMoreMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowMoreMenu(false);
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEsc);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [showMoreMenu]);

  const buttonClass = cn(
    'p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted',
    'transition-colors h-7 w-7 flex items-center justify-center',
  );

  const handleReplyInThread = useCallback(() => {
    dispatch(setActiveThread(messageId));
    dispatch(openThreadPanel());
  }, [dispatch, messageId]);

  const handleTogglePin = useCallback(() => {
    // Pin toggle will be wired to a dedicated action when the backend is ready
    console.log('Toggle pin:', messageId, channelId, !isPinned);
  }, [messageId, channelId, isPinned]);

  const handleQuoteReply = useCallback(() => {
    onQuoteReply?.(content, senderId);
  }, [onQuoteReply, content, senderId]);

  const handleEmojiSelect = useCallback((emoji: string) => {
    // Reaction will be wired to Redux when the reactions slice is ready
    console.log('Add reaction:', emoji, messageId);
    setShowEmojiPicker(false);
  }, [messageId]);

  const handleCopyText = useCallback(() => {
    navigator.clipboard.writeText(content);
    setShowMoreMenu(false);
  }, [content]);

  const handleCopyLink = useCallback(() => {
    const permalink = `${window.location.origin}/chat/${channelId}#${messageId}`;
    navigator.clipboard.writeText(permalink);
    setShowMoreMenu(false);
  }, [channelId, messageId]);

  const handleEdit = useCallback(() => {
    // Edit will be wired when inline editing is implemented
    console.log('Edit message:', messageId);
    setShowMoreMenu(false);
  }, [messageId]);

  const handleDelete = useCallback(() => {
    // Delete will be wired when the confirmation dialog is implemented
    console.log('Delete message:', messageId);
    setShowMoreMenu(false);
  }, [messageId]);

  const menuItemClass = cn(
    'flex items-center gap-2 px-3 py-1.5 text-sm text-foreground',
    'hover:bg-muted cursor-pointer w-full text-left',
  );

  return (
    <div
      className={cn(
        'absolute -top-4 right-4 flex items-center',
        'bg-card border border-border rounded-lg shadow-md z-10',
        'opacity-0 group-hover:opacity-100 transition-opacity duration-150',
      )}
    >
      {/* Add reaction */}
      <button
        ref={emojiButtonRef}
        className={buttonClass}
        title="Add reaction"
        onClick={() => setShowEmojiPicker((prev) => !prev)}
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

      {/* Reply in thread */}
      <button
        className={buttonClass}
        title="Reply in thread"
        onClick={handleReplyInThread}
      >
        <ChatText size={16} />
      </button>

      {/* Pin/unpin */}
      <button
        className={buttonClass}
        title={isPinned ? 'Unpin message' : 'Pin message'}
        onClick={handleTogglePin}
      >
        <PushPin size={16} weight={isPinned ? 'fill' : 'regular'} />
      </button>

      {/* Quote reply */}
      <button
        className={buttonClass}
        title="Quote reply"
        onClick={handleQuoteReply}
      >
        <ArrowBendUpLeft size={16} />
      </button>

      {/* More actions */}
      <div className="relative" ref={moreMenuRef}>
        <button
          className={buttonClass}
          title="More actions"
          onClick={() => setShowMoreMenu((prev) => !prev)}
        >
          <DotsThreeVertical size={16} />
        </button>

        {showMoreMenu && (
          <div
            className={cn(
              'absolute top-full right-0 mt-1 z-50',
              'bg-card border border-border rounded-lg shadow-lg py-1',
              'min-w-[160px]',
            )}
          >
            <button className={menuItemClass} onClick={handleCopyText}>
              <Copy size={14} />
              <span>Copy text</span>
            </button>
            <button className={menuItemClass} onClick={handleCopyLink}>
              <LinkSimple size={14} />
              <span>Copy link</span>
            </button>
            {isOwnMessage && (
              <>
                <div className="my-1 border-t border-border" />
                <button className={menuItemClass} onClick={handleEdit}>
                  <Pencil size={14} />
                  <span>Edit message</span>
                </button>
                <button
                  className={cn(menuItemClass, 'text-red-500 hover:text-red-500')}
                  onClick={handleDelete}
                >
                  <Trash size={14} />
                  <span>Delete message</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
