import { useState, useCallback, useRef } from "react";
import { CalendarCheck } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { TodayMeetingsPanel } from "@/features/calendar/components/quick-view/TodayMeetingsPanel";

export function CalendarQuickView() {
  const [panelOpen, setPanelOpen] = useState(false);
  const buttonRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => setPanelOpen((prev) => !prev), []);
  const close = useCallback(() => setPanelOpen(false), []);

  return (
    <div className="relative" ref={buttonRef}>
      <button
        onClick={toggle}
        className={cn(
          "relative flex items-center justify-center w-7 h-7 rounded-md",
          "border border-border-nav transition-colors duration-150",
          "focus-ring",
          panelOpen
            ? "bg-primary/10 text-primary border-primary/30"
            : "text-muted-foreground hover:text-primary hover:border-primary/30",
        )}
        aria-label="Today's schedule"
      >
        <CalendarCheck size={20} weight={panelOpen ? "fill" : "duotone"} />
      </button>

      {panelOpen && <TodayMeetingsPanel onClose={close} anchorRef={buttonRef} />}
    </div>
  );
}
