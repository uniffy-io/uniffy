import { CaretLeft, CaretRight, GlobeHemisphereWest, SidebarSimple } from "@phosphor-icons/react";
import { useCalendarNavigation } from "@/features/calendar/hooks";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { toggleSidebar } from "@/features/calendar/store";
import { getTimezoneOffset } from "@/features/calendar/utils";
import { cn } from "@/shared/utils/cn";
import { formatTimeZoneLabel } from "@/shared/utils/timezone";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import type { ViewMode } from "@/features/calendar/types";

export function CalendarHeader() {
  const dispatch = useAppDispatch();
  const { isMobile } = useBreakpoint();
  const { headerTitle, viewMode, goToPrevious, goToNext, goToToday, changeViewMode } =
    useCalendarNavigation();

  const isSidebarCollapsed = useAppSelector((state) => state.calendarUi.isSidebarCollapsed);
  const timezoneLabel = formatTimeZoneLabel();
  const timezoneOffset = getTimezoneOffset();

  const viewModes: ViewMode[] = ["day", "week", "month", "agenda"];

  return (
    <div className="flex items-center justify-between px-3 md:px-5 py-2 md:py-3 bg-card border-b border-border">
      <div className="flex items-center gap-1 md:gap-2 min-w-0">
        {isMobile && isSidebarCollapsed && (
          <button
            onClick={() => dispatch(toggleSidebar())}
            className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors shrink-0"
            title="Show sidebar"
          >
            <SidebarSimple size={16} className="text-primary" />
          </button>
        )}

        <button
          onClick={goToPrevious}
          className="p-1.5 rounded-md hover:bg-muted transition-colors shrink-0"
          aria-label="Previous period"
        >
          <CaretLeft size={16} weight="bold" className="text-muted-foreground" />
        </button>

        <h1 className="text-sm md:text-base font-medium text-foreground min-w-0 truncate">
          {headerTitle}
        </h1>

        <button
          onClick={goToNext}
          className="p-1.5 rounded-md hover:bg-muted transition-colors shrink-0"
          aria-label="Next period"
        >
          <CaretRight size={16} weight="bold" className="text-muted-foreground" />
        </button>

        <button
          onClick={goToToday}
          className="px-2 md:px-3 py-1 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors shrink-0"
        >
          Today
        </button>
      </div>

      <div className="flex items-center gap-1 md:gap-4 shrink-0">
        <span
          className={cn(
            "items-center gap-1.5 px-2 py-1 text-sm text-muted-foreground rounded-md",
            isMobile ? "hidden" : "flex",
          )}
          title={`Your current timezone: ${timezoneLabel} (${timezoneOffset})`}
        >
          <GlobeHemisphereWest size={16} weight="duotone" />
          {/* Zone ids run long ("America/Argentina/Buenos Aires"); the title carries the full one. */}
          <span className="max-w-[11rem] truncate">{timezoneLabel}</span>
        </span>

        <div className="flex items-center gap-0.5">
          {viewModes.map((mode) => (
            <button
              key={mode}
              onClick={() => changeViewMode(mode)}
              className={cn(
                "px-2 md:px-3 py-1 text-sm rounded-md transition-colors",
                viewMode === mode
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
