import { useMemo, useState } from "react";
import { useAppSelector } from "@/app/hooks";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { useDashboardFetch } from "@/features/dashboard/hooks/useDashboardFetch";
import { useMyTasks } from "@/features/dashboard/hooks/useMyTasks";
import { MyTasksDialog } from "@/features/dashboard/components/MyTasksDialog";
import { cn } from "@/shared/utils/cn";
import { QuickStatsWidget } from "@/features/dashboard/components/widgets/QuickStatsWidget";
import { TodayAgendaWidget } from "@/features/dashboard/components/widgets/TodayAgendaWidget";
import { MyTasksWidget } from "@/features/dashboard/components/widgets/MyTasksWidget";
import {
  DashboardActions,
  DashboardCustomizerPanel,
} from "@/features/dashboard/components/DashboardCustomizer";
import { DashboardNameField } from "@/features/dashboard/components/DashboardNameField";
import { DashboardWidgetView } from "@/features/dashboard/components/DashboardWidgetView";
import { WidgetSkeleton } from "@/features/dashboard/components/widgets/WidgetCard";
import { useDashboardRefresh } from "@/features/dashboard/hooks/useDashboardRefresh";
import { useDashboardLayout } from "@/features/dashboard/hooks/useDashboardLayout";
import { ArrowsClockwise, WarningCircle, ArrowRight } from "@phosphor-icons/react";
import { formatInTimeZone } from "date-fns-tz";
import { effectiveDayKey, formatTimeInZone } from "@/shared/utils/dateFormatting";
import { getEffectiveTimeZone } from "@/shared/utils/timezone";
import type { CalendarEvent } from "@/features/calendar/types";

// Greeting, date line and "today" buckets all live on the display zone's clock.
function getGreeting(): string {
  const hour = Number(formatInTimeZone(new Date(), getEffectiveTimeZone(), "H"));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatTodayDate(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: getEffectiveTimeZone(),
  });
}

function useContextualSummary() {
  const events = useAppSelector((state) => state.calendar?.events ?? {});
  const unreadCount = useAppSelector((state) => state.notifications?.unreadCount ?? 0);
  const { overdue, dueToday } = useMyTasks();

  return useMemo(() => {
    const todayKey = effectiveDayKey(new Date());

    const eventsToday = Object.values(events).filter(
      (event: CalendarEvent) => effectiveDayKey(new Date(event.startTime)) === todayKey,
    ).length;

    const tasksDueToday = dueToday.length;

    const parts: string[] = [];
    if (eventsToday > 0) parts.push(`${eventsToday} event${eventsToday !== 1 ? "s" : ""} today`);
    if (tasksDueToday > 0) parts.push(`${tasksDueToday} task${tasksDueToday !== 1 ? "s" : ""} due`);
    if (unreadCount > 0)
      parts.push(`${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}`);

    return { summary: parts.join(", "), overdueCount: overdue.length };
  }, [events, overdue, dueToday, unreadCount]);
}

export function Dashboard() {
  useDocumentTitle();
  const { refresh } = useDashboardFetch();

  const { user } = useAppSelector((state) => state.auth);
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);

  const { lastRefreshed, isRefreshing, manualRefresh } = useDashboardRefresh({
    onManualRefresh: refresh,
  });
  const layout = useDashboardLayout();

  const { summary, overdueCount } = useContextualSummary();
  const [isOverdueDialogOpen, setIsOverdueDialogOpen] = useState(false);
  const displayName = user?.fullName?.split(" ")[0] || user?.username || "there";

  if (isZenMode) {
    return (
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <TodayAgendaWidget />
          <MyTasksWidget />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            {getGreeting()}, {displayName}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {summary ? `${formatTodayDate()} - ${summary}` : formatTodayDate()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!layout.isEditing && layout.ready && (
            <DashboardActions
              catalog={layout.catalog}
              activePreset={layout.activePreset}
              hasPrevious={layout.hasPrevious}
              saving={layout.saving}
              onStartEditing={layout.startEditing}
              onApplyPreset={layout.applyPreset}
              onShowEverything={layout.resetToDefault}
              onRestorePrevious={() => void layout.restorePrevious()}
            />
          )}
          {!layout.isEditing && (
            <button
              onClick={manualRefresh}
              disabled={isRefreshing}
              className={cn(
                "hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground",
                "hover:text-foreground transition-colors",
              )}
              title="Refresh dashboard"
            >
              <ArrowsClockwise size={14} className={cn(isRefreshing && "animate-spin")} />
              <span>
                {isRefreshing
                  ? "Refreshing..."
                  : formatTimeInZone(lastRefreshed, getEffectiveTimeZone())}
              </span>
            </button>
          )}
        </div>
      </div>

      {overdueCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5 dark:border-red-900/50 dark:bg-red-950/30">
          <div className="rounded-lg bg-red-100 p-2 dark:bg-red-900/50">
            <WarningCircle size={18} weight="fill" className="text-red-600 dark:text-red-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-800 dark:text-red-300">
              You have {overdueCount} overdue task{overdueCount !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsOverdueDialogOpen(true)}
            className="flex items-center gap-1 text-xs font-medium text-red-700 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 transition-colors shrink-0"
          >
            View tasks
            <ArrowRight size={12} />
          </button>
        </div>
      )}
      {isOverdueDialogOpen && (
        <MyTasksDialog initialView="overdue" onClose={() => setIsOverdueDialogOpen(false)} />
      )}

      {layout.isEditing && layout.catalog && (
        <DashboardCustomizerPanel
          catalog={layout.catalog}
          widgets={layout.widgets}
          saving={layout.saving}
          dashboardName={layout.name}
          onRename={layout.setName}
          onCancel={layout.cancelEditing}
          onSave={layout.saveEditing}
          onToggleVisibility={layout.toggleVisibility}
          onToggleSize={layout.toggleSize}
          onSetFilters={layout.setFilters}
          onMove={layout.moveWidget}
          onReset={layout.resetToDefault}
        />
      )}

      <QuickStatsWidget />

      {layout.ready && !layout.isEditing && (
        <h2 className="text-base font-semibold tracking-tight">
          <DashboardNameField
            value={layout.name}
            onSave={layout.rename}
            emptyLabel="Add a name"
            disabled={layout.saving}
            testId="dashboard-name"
          />
        </h2>
      )}

      {layout.ready ? (
        <div
          className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4"
          data-testid="dashboard-widgets"
        >
          {layout.visibleWidgets.map((widget) => (
            <DashboardWidgetView key={widget.id} widget={widget} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[0, 1].map((slot) => (
            <div key={slot} className="rounded-xl bg-surface p-6 shadow-edge md:col-span-2">
              <WidgetSkeleton rows={4} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
