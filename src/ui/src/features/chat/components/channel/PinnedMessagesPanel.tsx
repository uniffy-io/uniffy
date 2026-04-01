/**
 * PinnedMessagesPanel - Dropdown panel showing all pinned messages in a channel.
 *
 * Opens from the pin button in the channel header. Shows each pinned message
 * with sender, content preview, and timestamp. Click navigates to the message
 * in the channel. Renders via portal to avoid overflow issues.
 */

import { useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { PushPin, X } from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { SubjectAvatarById } from '@/components/subject';
import { selectMessagesForChannel } from '@/features/chat/store/chatMessagesSlice';
import { formatRelativeTime } from '@/shared/utils/dateFormatting';
import { MessageContent } from '@/features/chat/components/channel/MessageContent';

interface PinnedMessagesPanelProps {
  channelId: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onJumpToMessage?: (messageId: string) => void;
}

export function PinnedMessagesPanel({ channelId, anchorRef, onClose, onJumpToMessage }: PinnedMessagesPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const messages = useAppSelector((state) => selectMessagesForChannel(state, channelId));

  const pinnedMessages = useMemo(
    () => messages.filter(m => m.isPinned && !m.isDeleted),
    [messages],
  );

  // Position below the anchor
  const position = useMemo(() => {
    const anchor = anchorRef.current;
    if (!anchor) return { top: 100, left: 100 };

    const rect = anchor.getBoundingClientRect();
    const panelWidth = 380;

    let left = rect.left;
    // Don't go off right edge
    if (left + panelWidth > window.innerWidth - 16) {
      left = window.innerWidth - panelWidth - 16;
    }
    if (left < 16) left = 16;

    return { top: rect.bottom + 6, left };
  }, [anchorRef]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Escape to close
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[100] w-[380px] max-h-[60vh] bg-card border border-border rounded-xl shadow-xl overflow-hidden flex flex-col"
      style={{ top: position.top, left: position.left }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <PushPin size={16} className="text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">
            Pinned Messages
          </span>
          <span className="text-xs text-muted-foreground">
            ({pinnedMessages.length})
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Pinned messages list */}
      <div className="flex-1 overflow-y-auto">
        {pinnedMessages.length === 0 ? (
          <div className="py-8 px-4 text-center">
            <PushPin size={32} className="mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No pinned messages</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Pin important messages so they are easy to find.
            </p>
          </div>
        ) : (
          pinnedMessages.map(message => {
            const senderName = message.senderName ?? 'Unknown';

            return (
              <div
                key={message.id}
                className="px-4 py-3 border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                onClick={() => {
                  onJumpToMessage?.(message.id);
                  onClose();
                }}
              >
                {/* Sender info */}
                <div className="flex items-center gap-2 mb-1.5">
                  <SubjectAvatarById userId={message.senderId} displayName={senderName} size="xs" />
                  <span className="text-sm font-semibold text-foreground">{senderName}</span>
                  <span className="text-xs text-muted-foreground">{formatRelativeTime(message.createdAt)}</span>
                </div>

                {/* Message content preview */}
                <div className="ml-8 text-sm line-clamp-3">
                  <MessageContent content={message.content} />
                </div>

                {/* Pin indicator */}
                <div className="ml-8 mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <PushPin size={10} weight="fill" className="text-primary/60" />
                  <span>Pinned</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>,
    document.body,
  );
}
