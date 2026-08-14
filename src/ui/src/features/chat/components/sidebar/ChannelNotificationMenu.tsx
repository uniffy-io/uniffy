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
    const members = state.chatChannels.channelMembers[channelId];
    const me = members?.find((m) => m.userId === currentUserId);
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
      { label: "Until tomorrow 9:00 AM", action: () => handleMute(getNextMorning().toISOString()) },
    ],
    [handleMute],
  );

  const notificationOptions: { label: string; value: NotificationLevel; icon: typeof Bell }[] = [
    { label: "All new messages", value: "ALL", icon: BellRinging },
    { label: "Mentions only", value: "MENTIONS", icon: Bell },
    { label: "Nothing", value: "NONE", icon: BellSlash },
  ];

  const btnClass =
    "flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent cursor-pointer w-full text-left transition-colors text-foreground";

  return (
    <div className="py-1 min-w-[220px]">
      <div className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Mute
      </div>
      {!isMuted ? (
        muteOptions.map((opt) => (
          <button key={opt.label} type="button" onClick={opt.action} className={btnClass}>
            <Clock size={16} className="text-muted-foreground shrink-0" />
            <span>{opt.label}</span>
          </button>
        ))
      ) : (
        <button type="button" onClick={handleUnmute} className={btnClass}>
          <SpeakerHigh size={16} className="text-muted-foreground shrink-0" />
          <span>Unmute channel</span>
        </button>
      )}

      <div className="my-1 h-px bg-border mx-2" />

      <div className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Notify me about
      </div>
      {notificationOptions.map((opt) => {
        const Icon = opt.icon;
        const isSelected = notificationLevel === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => handleNotificationLevel(opt.value)}
            className={btnClass}
          >
            <Icon size={16} className="text-muted-foreground shrink-0" />
            <span className="flex-1">{opt.label}</span>
            {isSelected && <Check size={14} className="text-primary shrink-0" />}
          </button>
        );
      })}

      <div className="my-1 h-px bg-border mx-2" />

      <button type="button" onClick={handleToggleFollowThreads} className={btnClass}>
        <ChatCircle size={16} className="text-muted-foreground shrink-0" />
        <span className="flex-1">Follow all threads</span>
        {followAllThreads && <Check size={14} className="text-primary shrink-0" />}
      </button>
    </div>
  );
}
