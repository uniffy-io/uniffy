import { Phone } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { getInitials } from "@/components/subject/utils";
import { popoverShellClass } from "@/components/ui/popover";
import { selectActiveCallForChannel } from "@/features/calls/store/callsSlice";
import { cn } from "@/shared/utils/cn";

/** Sidebar "live call" pill with participant count; avatars on hover. */
export function ChannelCallIndicator({ channelId }: { channelId: string }) {
  const call = useAppSelector((s) => selectActiveCallForChannel(s, channelId));
  if (!call || call.participants.length === 0) return null;

  return (
    <span
      className="group/call relative flex shrink-0 items-center gap-0.5 text-emerald-500"
      data-testid={`chat-sidebar-channel-call-${channelId}`}
    >
      <Phone size={12} weight="fill" />
      <span className="text-[10px] font-semibold tabular-nums">{call.participants.length}</span>
      <span
        className={cn(
          popoverShellClass,
          "pointer-events-none absolute bottom-full right-0 z-50 mb-1 hidden w-max max-w-56 flex-col gap-1 p-2 group-hover/call:flex",
        )}
      >
        {call.participants.slice(0, 6).map((p) => (
          <span key={p.identity} className="flex items-center gap-1.5 text-xs text-foreground">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[9px] font-semibold text-primary">
              {getInitials(p.displayName)}
            </span>
            <span className="truncate">{p.displayName}</span>
          </span>
        ))}
        {call.participants.length > 6 && (
          <span className="text-[10px] text-muted-foreground">
            +{call.participants.length - 6} more
          </span>
        )}
      </span>
    </span>
  );
}
