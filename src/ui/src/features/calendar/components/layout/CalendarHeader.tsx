import { CaretLeft, CaretRight, GlobeHemisphereWest, SidebarSimple, FrameCorners } from '@phosphor-icons/react';
import { useCalendarNavigation } from '@/features/calendar/hooks';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { toggleSidebar, setDetailViewMode } from '@/features/calendar/store';
import { getTimezoneOffset } from '@/features/calendar/utils';
import { cn } from '@/shared/utils/cn';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import type { ViewMode } from '@/features/calendar/types';

export function CalendarHeader() {
  const dispatch = useAppDispatch();
  const { isMobile } = useBreakpoint();
  const {
    headerTitle,
    viewMode,
    goToPrevious,
    goToNext,
    goToToday,
    changeViewMode,
  } = useCalendarNavigation();

  const displayTimezone = useAppSelector(
    (state) => state.calendarUi.displayTimezone
  );
  const isSidebarCollapsed = useAppSelector(
    (state) => state.calendarUi.isSidebarCollapsed
  );
  const detailViewMode = useAppSelector(
    (state) => state.calendarUi.detailViewMode
  );

  const timezoneOffset = getTimezoneOffset(displayTimezone);

  const viewModes: ViewMode[] = ['day', 'week', 'month', 'agenda'];

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
            isMobile ? "hidden" : "flex"
          )}
          title="Your current timezone"
        >
          <GlobeHemisphereWest size={16} weight="duotone" />
          <span>{timezoneOffset}</span>
        </span>

        <div className={cn(
          "items-center gap-0.5 border border-border rounded-md p-0.5 shrink-0",
          isMobile ? "hidden" : "flex"
        )}>
          <button
            type="button"
            onClick={() => dispatch(setDetailViewMode('sidebar'))}
            className={cn(
              'p-1 rounded transition-colors',
              detailViewMode === 'sidebar' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
            title="Sidebar panel"
          >
            <SidebarSimple size={14} />
          </button>
          <button
            type="button"
            onClick={() => dispatch(setDetailViewMode('modal'))}
            className={cn(
              'p-1 rounded transition-colors',
              detailViewMode === 'modal' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
            title="Modal view"
          >
            <FrameCorners size={14} />
          </button>
        </div>

        <div className="flex items-center gap-0.5">
          {viewModes.map((mode) => (
            <button
              key={mode}
              onClick={() => changeViewMode(mode)}
              className={cn(
                'px-2 md:px-3 py-1 text-sm rounded-md transition-colors',
                viewMode === mode
                  ? 'text-primary bg-primary/10'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
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
