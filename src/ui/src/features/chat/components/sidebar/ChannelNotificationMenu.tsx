import { ActionMenuItem, ActionMenuSeparator } from "@/components/ui/action-menu";
import { useCallback, useMemo } from "react";
import {
  SpeakerHigh,
  Bell,
  BellSlash,
  BellRinging,
  ChatCircle,
  Clock,
  Check,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { updateChannelMember } from "@/features/chat/store/chatThunks";
import { selectChannelPreferences } from "@/features/chat/store/chatChannelsSlice";
import { ChatNotificationLevel } from "@uniffy/proto/chat/v1/chat_pb";
import type { NotificationLevel } from "@/features/chat/types";

interface ChannelNotificationMenuProps {
  channelId: string;
  onClose: () => void;
}

function getNextMorning(): Date {
  const now = new Date();
  const target = new Date(now);
  target.setHours(9, 0, 0, 0);
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }
  return target;
}

const NOTIFICATION_LEVEL_PROTO_MAP: Record<NotificationLevel, number> = {
  ALL: ChatNotificationLevel.ALL,
  MENTIONS: ChatNotificationLevel.MENTIONS,
  NONE: ChatNotificationLevel.NONE,
};

export function ChannelNotificationMenu({ channelId, onClose }: ChannelNotificationMenuProps) {
  const dispatch = useAppDispatch();
  const currentUserId = useAppSelector((state) => state.auth.user?.id ?? "");
  const prefs = useAppSelector(selectChannelPreferences);
  const channelPrefs = prefs[channelId];
  const members = useAppSelector((state) => state.chatChannels.channelMembers[channelId]);
  const currentMember = members?.find((m) => m.userId === currentUserId);
  const isMuted = channelPrefs?.isMuted ?? currentMember?.isMuted ?? false;
  const notificationLevel =
    channelPrefs?.notificationLevel ?? currentMember?.notificationLevel ?? "ALL";
  const followAllThreads = useAppSelector((state) => {
    const channelMembers = state.chatChannels.channelMembers[channelId];
    const me = channelMembers?.find((m) => m.userId === currentUserId);
    return me?.followAllThreads ?? false;
  });

  const handleMute = useCallback(
    (mutedUntil?: string) => {
      dispatch(
        updateChannelMember({
          channelId,
          userId: currentUserId,
          isMuted: true,
          mutedUntil,
        }),
      );
      onClose();
    },
    [dispatch, channelId, currentUserId, onClose],
  );

  const handleUnmute = useCallback(() => {
    dispatch(
      updateChannelMember({
        channelId,
        userId: currentUserId,
        isMuted: false,
      }),
    );
    onClose();
  }, [dispatch, channelId, currentUserId, onClose]);

  const handleNotificationLevel = useCallback(
    (level: NotificationLevel) => {
      dispatch(
        updateChannelMember({
          channelId,
          userId: currentUserId,
          notificationLevel: NOTIFICATION_LEVEL_PROTO_MAP[level],
        }),
      );
      onClose();
    },
    [dispatch, channelId, currentUserId, onClose],
  );

  const handleToggleFollowThreads = useCallback(() => {
    dispatch(
      updateChannelMember({
        channelId,
        userId: currentUserId,
        followAllThreads: !followAllThreads,
      }),
    );
    onClose();
  }, [dispatch, channelId, currentUserId, followAllThreads, onClose]);

  const muteOptions = useMemo(
    () => [
      { label: "Mute indefinitely", action: () => handleMute() },
      {
        label: "For 1 hour",
        action: () => handleMute(new Date(Date.now() + 3_600_000).toISOString()),
      },
      {
        label: "For 8 hours",
        action: () => handleMute(new Date(Date.now() + 28_800_000).toISOString()),
      },
      {
        label: "For 24 hours",
        action: () => handleMute(new Date(Date.now() + 86_400_000).toISOString()),
      },
      {
        label: "Until tomorrow 9:00 AM",
        action: () => handleMute(getNextMorning().toISOString()),
      },
    ],
    [handleMute],
  );

  const notificationOptions: { label: string; value: NotificationLevel; icon: typeof Bell }[] = [
    { label: "All new messages", value: "ALL", icon: BellRinging },
    { label: "Mentions only", value: "MENTIONS", icon: Bell },
    { label: "Nothing", value: "NONE", icon: BellSlash },
  ];

  return (
    <div className="py-1 min-w-[220px]">
      <div className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Mute
      </div>
      {!isMuted ? (
        muteOptions.map((opt) => (
          <ActionMenuItem key={opt.label} type="button" onClick={opt.action}>
            <Clock size={16} className="text-muted-foreground shrink-0" />
            <span>{opt.label}</span>
          </ActionMenuItem>
        ))
      ) : (
        <ActionMenuItem type="button" onClick={handleUnmute}>
          <SpeakerHigh size={16} className="text-muted-foreground shrink-0" />
          <span>Unmute channel</span>
        </ActionMenuItem>
      )}

      <ActionMenuSeparator />

      <div className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Notify me about
      </div>
      {notificationOptions.map((opt) => {
        const Icon = opt.icon;
        const isSelected = notificationLevel === opt.value;
        return (
          <ActionMenuItem
            key={opt.value}
            type="button"
            role="menuitemradio"
            aria-checked={isSelected}
            onClick={() => handleNotificationLevel(opt.value)}
          >
            <Icon size={16} className="text-muted-foreground shrink-0" />
            <span className="flex-1">{opt.label}</span>
            {isSelected && <Check size={14} className="text-primary shrink-0" />}
          </ActionMenuItem>
        );
      })}

      <ActionMenuSeparator />

      <ActionMenuItem
        type="button"
        role="menuitemcheckbox"
        aria-checked={followAllThreads}
        onClick={handleToggleFollowThreads}
      >
        <ChatCircle size={16} className="text-muted-foreground shrink-0" />
        <span className="flex-1">Follow all threads</span>
        {followAllThreads && <Check size={14} className="text-primary shrink-0" />}
      </ActionMenuItem>
    </div>
  );
}
