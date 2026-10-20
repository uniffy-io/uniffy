import { memo, useCallback, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { SubjectAvatarById } from "@/components/subject";
import { DirectMessageListItem } from "@/features/chat/components/sidebar/DirectMessageListItem";
import { openSelfChat } from "@/features/chat/store/chatThunks";
import type { ChatChannel } from "@/features/chat/types";
import { selfConversationLabel } from "@/features/chat/utils/channelDisplay";
import { cn } from "@/shared/utils/cn";

interface SelfConversationListItemProps {
  /** The viewer's own conversation, or null until the first open creates it. */
  channel: ChatChannel | null;
  isActive: boolean;
  unreadCount?: number;
  isMuted?: boolean;
  hasDraft?: boolean;
  onSelect: (channelId: string) => void;
}

/** The pinned first DM row; it exists before the channel does so the sidebar never creates rows. */
export const SelfConversationListItem = memo(function SelfConversationListItem({
  channel,
  isActive,
  unreadCount,
  isMuted,
  hasDraft,
  onSelect,
}: SelfConversationListItemProps) {
  if (channel) {
    return (
      <DirectMessageListItem
        channel={channel}
        isActive={isActive}
        unreadCount={unreadCount}
        isMuted={isMuted}
        hasDraft={hasDraft}
        onSelect={onSelect}
      />
    );
  }
  return <SelfConversationPlaceholder onSelect={onSelect} />;
});

function SelfConversationPlaceholder({ onSelect }: { onSelect: (channelId: string) => void }) {
  const dispatch = useAppDispatch();
  const currentUserId = useAppSelector((s) => s.auth.user?.id ?? "");
  const currentUserName = useAppSelector((s) => s.auth.user?.fullName ?? "");
  const [opening, setOpening] = useState(false);

  const handleClick = useCallback(async () => {
    setOpening(true);
    try {
      const channel = await dispatch(openSelfChat()).unwrap();
      onSelect(channel.id);
    } catch {
      // The rejected thunk already surfaced its toast.
    } finally {
      setOpening(false);
    }
  }, [dispatch, onSelect]);

  return (
    <div
      className={cn(
        "group/dm relative flex items-center rounded-md mx-1.5 transition-colors",
        "max-w-[calc(100%-12px)] text-foreground/90 hover:bg-muted/60 hover:text-foreground",
      )}
      data-testid="chat-sidebar-self-dm-placeholder"
      data-dm-kind="self"
    >
      <button
        type="button"
        onClick={handleClick}
        disabled={opening}
        aria-busy={opening}
        className="flex items-center gap-2 flex-1 min-w-0 px-3 py-1.5 cursor-pointer text-left bg-transparent disabled:cursor-wait"
      >
        <div className="shrink-0">
          <SubjectAvatarById userId={currentUserId} displayName={currentUserName} size="sm" />
        </div>
        <span className="truncate text-[0.9rem] font-[450] flex-1">
          {selfConversationLabel(currentUserName)}
        </span>
      </button>
    </div>
  );
}
