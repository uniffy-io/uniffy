import { useEffect, useState } from "react";
import { callReactions } from "@/features/calls/utils/callReactions";
import { useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { popoverShellClass } from "@/components/ui/popover";

export function CallReactionOverlay() {
  const received = useAppSelector((s) => s.calls.reactions);
  const callId = useAppSelector((s) => s.calls.session.callId);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  return (
    <div
      role="log"
      aria-label="Call reactions"
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none absolute inset-x-3 bottom-10 z-10 flex flex-col items-start gap-1.5"
    >
      {received
        .filter((r) => r.callId === callId && r.expiresAt > now)
        .slice(-3)
        .map((r) => {
          const option = callReactions.find((o) => o.value === r.reaction);
          if (!option) return null;
          const Icon = option.Icon;
          return (
            <div
              key={r.id}
              className={cn(
                popoverShellClass,
                "flex max-w-full items-center gap-2 px-2.5 py-1.5 text-xs motion-safe:animate-in motion-safe:fade-in",
              )}
            >
              <Icon size={18} className="shrink-0 text-primary" />
              <span className="truncate">
                {r.displayName}
                <span className="sr-only">: {option.label}</span>
              </span>
            </div>
          );
        })}
    </div>
  );
}
