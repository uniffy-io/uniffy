import { cn } from "@/shared/utils/cn";

interface LiveMeetingBadgeProps {
  participantCount?: number;
  /** `dot` drops the label for grid chips, where there is no room for words. */
  variant?: "full" | "dot";
  className?: string;
}

/**
 * One live-meeting indicator for every surface that draws an event, so the
 * detail modal, the today list and the grid chips agree on what "a call is
 * happening in this meeting right now" looks like.
 */
export function LiveMeetingBadge({
  participantCount = 0,
  variant = "full",
  className,
}: LiveMeetingBadgeProps) {
  const pulse = (
    <span className="relative flex h-1.5 w-1.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-500" />
    </span>
  );

  if (variant === "dot") {
    // The chip has no room for the count, so the dot carries it in its tooltip
    // rather than dropping it entirely.
    const title =
      participantCount > 0
        ? `Meeting in progress - ${participantCount} ${participantCount === 1 ? "person" : "people"}`
        : "Meeting in progress";
    return (
      <span className={cn("flex-shrink-0", className)} title={title}>
        {pulse}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5",
        "text-[10px] font-medium text-rose-600 dark:text-rose-400",
        className,
      )}
    >
      {pulse}
      Live{participantCount > 0 ? ` · ${participantCount}` : ""}
    </span>
  );
}
