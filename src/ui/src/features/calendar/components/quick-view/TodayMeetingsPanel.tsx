import { useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowsClockwise, CheckCircle, ArrowRight, Sun, X } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { useTodayEvents } from "@/features/calendar/hooks/useTodayEvents";
import { TodayEventItem } from "@/features/calendar/components/quick-view/TodayEventItem";
import { formatTime } from "@/features/calendar/utils";
import type { CalendarEvent } from "@/features/calendar/types";

interface TodayMeetingsPanelProps {
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="sticky top-0 z-10 px-3.5 py-1.5 bg-card/95 backdrop-blur-sm border-b border-border/50">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
        {label}
      </span>
    </div>
  );
}

function EmptyState({ allDone }: { allDone: boolean }) {
  if (allDone) {
    return (
      <div className="flex flex-col items-center justify-center py-10 px-6">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 mb-3">
          <CheckCircle size={24} weight="duotone" className="text-green-600 dark:text-green-400" />
        </div>
        <p className="text-sm font-medium text-foreground/60 mb-1">All done for today</p>
        <p className="text-xs text-muted-foreground/60 text-center max-w-[200px]">
          No more meetings remaining
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-10 px-6">
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-muted/50 mb-3">
        <Sun size={24} weight="duotone" className="text-muted-foreground/50" />
      </div>
      <p className="text-sm font-medium text-foreground/60 mb-1">No meetings today</p>
      <p className="text-xs text-muted-foreground/60 text-center max-w-[200px]">
        Your schedule is clear
      </p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="px-3.5 py-3 space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex gap-2.5 animate-pulse">
          <div className="w-0.5 rounded-full bg-muted shrink-0 h-10" />
          <div className="flex-1 space-y-2">
            <div className="h-2.5 bg-muted rounded w-1/3" />
            <div className="h-3.5 bg-muted rounded w-3/4" />
            <div className="h-2.5 bg-muted/60 rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function PanelContent({
  onClose,
  onEventClick,
  onViewAll,
  isMobile,
}: {
  onClose: () => void;
  onEventClick: (event: CalendarEvent) => void;
  onViewAll: () => void;
  isMobile: boolean;
}) {
  const { groups, now, upcomingCount, loading, refresh } = useTodayEvents(true);

  const todayLabel = useMemo(() => {
    return new Date().toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }, []);

  const hasPastEvents = groups.past.length > 0;
  const hasUpcoming = upcomingCount > 0;
  const hasAnyEvents = hasPastEvents || hasUpcoming;

  const currentEvents = groups.current;
  const nextEvent = groups.next;
  const laterEvents = groups.later;

  const lastEndTime = useMemo(() => {
    const allUpcoming = [...currentEvents, ...(nextEvent ? [nextEvent] : []), ...laterEvents];
    if (allUpcoming.length === 0) return null;
    const last = allUpcoming[allUpcoming.length - 1];
    return formatTime(last.endTime);
  }, [currentEvents, nextEvent, laterEvents]);

  return (
    <>
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-border shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Today&apos;s Schedule</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {todayLabel}
              {hasUpcoming && (
                <span className="ml-1.5 text-foreground/60">- {upcomingCount} upcoming</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={refresh}
              disabled={loading}
              className={cn(
                "p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
                loading && "animate-spin",
              )}
              title="Refresh"
            >
              <ArrowsClockwise size={14} />
            </button>
            <button
              onClick={onViewAll}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="View calendar"
            >
              <ArrowRight size={14} />
            </button>
            {isMobile && (
              <button
                onClick={onClose}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Close"
              >
                <X size={14} weight="bold" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && !hasAnyEvents ? (
          <LoadingSkeleton />
        ) : !hasAnyEvents ? (
          <EmptyState allDone={false} />
        ) : !hasUpcoming && hasPastEvents ? (
          <EmptyState allDone />
        ) : (
          <div>
            {groups.current.length > 0 && (
              <div>
                <SectionHeader label="Happening now" />
                {groups.current.map((event) => (
                  <TodayEventItem
                    key={event.id}
                    event={event}
                    isCurrent
                    now={now}
                    onClick={onEventClick}
                  />
                ))}
              </div>
            )}

            {groups.next && (
              <div>
                <SectionHeader label="Up next" />
                <TodayEventItem event={groups.next} now={now} onClick={onEventClick} />
              </div>
            )}

            {groups.later.length > 0 && (
              <div>
                <SectionHeader label="Later today" />
                {groups.later.map((event) => (
                  <TodayEventItem key={event.id} event={event} now={now} onClick={onEventClick} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {lastEndTime && hasUpcoming && (
        <div className="px-3.5 py-2 border-t border-border shrink-0">
          <p className="text-[11px] text-muted-foreground/60 text-center">
            Free after {lastEndTime}
          </p>
        </div>
      )}
    </>
  );
}

export function TodayMeetingsPanel({ onClose, anchorRef }: TodayMeetingsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { isMobile } = useBreakpoint();

  useEffect(() => {
    if (isMobile) return;

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        !(anchorRef?.current && anchorRef.current.contains(target))
      ) {
        onClose();
      }
    }

    const timeoutId = setTimeout(() => {
      document.addEventListener("click", handleClickOutside, true);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("click", handleClickOutside, true);
    };
  }, [onClose, isMobile, anchorRef]);

  useEffect(() => {
    if (!isMobile) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobile]);

  const handleEventClick = (event: CalendarEvent) => {
    navigate(`/calendar?event=${event.id}`);
    onClose();
  };

  const handleViewAll = () => {
    navigate("/calendar");
    onClose();
  };

  const contentProps = {
    onClose,
    onEventClick: handleEventClick,
    onViewAll: handleViewAll,
    isMobile,
  };

  if (isMobile) {
    return (
      <>
        <div
          className="fixed inset-0 z-[99] bg-black/50 animate-in fade-in duration-200"
          onClick={onClose}
        />
        <div
          ref={panelRef}
          className={cn(
            "fixed inset-x-0 bottom-0 z-[100] max-h-[85dvh]",
            "bg-card border-t border-border rounded-t-2xl shadow-xl",
            "animate-in slide-in-from-bottom duration-300",
            "flex flex-col overflow-hidden",
          )}
        >
          <div className="flex justify-center pt-2 pb-1 shrink-0">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/20" />
          </div>
          <PanelContent {...contentProps} />
        </div>
      </>
    );
  }

  return (
    <div
      ref={panelRef}
      className={cn(
        "absolute right-0 z-[100] mt-1.5 w-[min(360px,calc(100vw-2rem))] max-h-[70vh] origin-top-right rounded-xl",
        "bg-card shadow-xl border border-border",
        "animate-in fade-in slide-in-from-top-2 duration-200",
        "flex flex-col overflow-hidden",
      )}
    >
      <PanelContent {...contentProps} />
    </div>
  );
}
