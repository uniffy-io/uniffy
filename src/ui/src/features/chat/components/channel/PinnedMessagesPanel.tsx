import { useRef, useEffect, useState } from "react";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";
import { createPortal } from "react-dom";
import { PushPin, X } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { SubjectAvatarById } from "@/components/subject";
import { dialogShellClass } from "@/components/ui/popover";
import { cn } from "@/shared/utils/cn";
import { AgentAvatar } from "@/features/agents/components/AgentAvatar";
import { fetchPinnedMessages } from "@/features/chat/store/chatThunks";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";
import { MessageContent } from "@/features/chat/components/channel/MessageContent";
import type { ChatMessage } from "@/features/chat/types";

interface PinnedMessagesPanelProps {
  channelId: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onJumpToMessage?: (messageId: string) => void;
}

export function PinnedMessagesPanel({
  channelId,
  anchorRef,
  onClose,
  onJumpToMessage,
}: PinnedMessagesPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const agentsById = useAppSelector((state) => state.agents.agents);
  const [pinnedMessages, setPinnedMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    // eslint-disable-next-line react/react-compiler -- loading state tied to async fetch lifecycle
    setIsLoading(true);
    dispatch(fetchPinnedMessages(channelId))
      .unwrap()
      .then((messages) => {
        if (!cancelled) setPinnedMessages(messages);
      })
      .catch(() => {
        if (!cancelled) setPinnedMessages([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, organizationId, dispatch]);

  const [position, setPosition] = useState({ top: 100, left: 100 });

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const panelWidth = 380;

    let left = rect.left;
    if (left + panelWidth > window.innerWidth - 16) {
      left = window.innerWidth - panelWidth - 16;
    }
    if (left < 16) left = 16;

    setPosition({ top: rect.bottom + 6, left });
  }, [anchorRef]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  useOverlayEscape(onClose);

  return createPortal(
    <div
      ref={panelRef}
      className={cn(
        dialogShellClass,
        "fixed z-[100] w-[380px] max-h-[60vh] rounded-xl overflow-hidden flex flex-col",
      )}
      style={{ top: position.top, left: position.left }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <PushPin size={16} className="text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Pinned Messages</span>
          <span className="text-xs text-muted-foreground">({pinnedMessages.length})</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="py-8 px-4 text-center">
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        ) : pinnedMessages.length === 0 ? (
          <div className="py-8 px-4 text-center">
            <PushPin size={32} className="mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No pinned messages</p>
            <p className="text-xs text-subtle-foreground mt-1">
              Pin important messages so they are easy to find.
            </p>
          </div>
        ) : (
          pinnedMessages.map((message) => {
            const isAgent = message.senderType === "AGENT";
            const agent = isAgent ? (agentsById[message.senderId] ?? null) : null;
            const senderName =
              (isAgent ? agent?.name : null) ??
              message.senderName ??
              (isAgent ? "Agent" : "Unknown User");

            return (
              <div
                key={message.id}
                className="px-4 py-3 border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                onClick={() => {
                  onJumpToMessage?.(message.id);
                  onClose();
                }}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  {isAgent ? (
                    <AgentAvatar
                      avatarKey={agent?.avatarKey}
                      avatarEmoji={agent?.avatarEmoji}
                      agentName={senderName}
                      size="xs"
                    />
                  ) : (
                    <SubjectAvatarById
                      userId={message.senderId}
                      displayName={senderName}
                      avatarUrl={message.senderAvatarUrl}
                      size="xs"
                    />
                  )}
                  <span className="text-sm font-semibold text-foreground">{senderName}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(message.createdAt)}
                  </span>
                </div>

                <div className="ml-8 text-sm line-clamp-3">
                  <MessageContent content={message.content} />
                </div>

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
