import type { ComponentType } from "react";
import { ErrorBoundary } from "@/components/feedback";
import { WidgetCard } from "@/features/dashboard/components/widgets/WidgetCard";
import { WidgetSizeContext } from "@/features/dashboard/components/widgets/widgetSize";
import { AgentQuickAccessWidget } from "@/features/dashboard/components/widgets/AgentQuickAccessWidget";
import { BookmarkedItemsWidget } from "@/features/dashboard/components/widgets/BookmarkedItemsWidget";
import { MyTasksWidget } from "@/features/dashboard/components/widgets/MyTasksWidget";
import { MyTimeWidget } from "@/features/dashboard/components/widgets/MyTimeWidget";
import { NotificationsSummaryWidget } from "@/features/dashboard/components/widgets/NotificationsSummaryWidget";
import { PeopleWidget } from "@/features/dashboard/components/widgets/PeopleWidget";
import { PersonalAnalyticsWidget } from "@/features/dashboard/components/widgets/PersonalAnalyticsWidget";
import { QuickActionsWidget } from "@/features/dashboard/components/widgets/QuickActionsWidget";
import { RecentActivityWidget } from "@/features/dashboard/components/widgets/RecentActivityWidget";
import { RecentFilesWidget } from "@/features/dashboard/components/widgets/RecentFilesWidget";
import { RecentNotesWidget } from "@/features/dashboard/components/widgets/RecentNotesWidget";
import { TeamPresenceWidget } from "@/features/dashboard/components/widgets/TeamPresenceWidget";
import { TodayAgendaWidget } from "@/features/dashboard/components/widgets/TodayAgendaWidget";
import { BugTrendWidget } from "@/features/dashboard/components/widgets/metrics/BugTrendWidget";
import { ProjectHealthWidget } from "@/features/dashboard/components/widgets/metrics/ProjectHealthWidget";
import { SprintProgressWidget } from "@/features/dashboard/components/widgets/metrics/SprintProgressWidget";
import { StatusByProjectWidget } from "@/features/dashboard/components/widgets/metrics/StatusByProjectWidget";
import { TaskListMetricWidget } from "@/features/dashboard/components/widgets/metrics/TaskListMetricWidget";
import { WorkloadWidget } from "@/features/dashboard/components/widgets/metrics/WorkloadWidget";
import type { DashboardWidget } from "@/features/dashboard/types";
import { isTaskListWidget } from "@/features/dashboard/utils/layout";

const PERSONAL: Record<string, ComponentType> = {
  "today-agenda": TodayAgendaWidget,
  "my-tasks": MyTasksWidget,
  "my-time": MyTimeWidget,
  "recent-activity": RecentActivityWidget,
  "quick-actions": QuickActionsWidget,
  "team-presence": TeamPresenceWidget,
  people: PeopleWidget,
  notifications: NotificationsSummaryWidget,
  "recent-notes": RecentNotesWidget,
  "recent-files": RecentFilesWidget,
  bookmarks: BookmarkedItemsWidget,
  analytics: PersonalAnalyticsWidget,
  agents: AgentQuickAccessWidget,
};

const METRIC: Record<string, ComponentType<{ widget: DashboardWidget }>> = {
  "sprint-progress": SprintProgressWidget,
  workload: WorkloadWidget,
  "status-by-project": StatusByProjectWidget,
  "project-health": ProjectHealthWidget,
  "bug-trend": BugTrendWidget,
};

function WidgetBody({ widget }: { widget: DashboardWidget }) {
  if (isTaskListWidget(widget.id)) {
    return <TaskListMetricWidget widget={{ ...widget, id: widget.id }} />;
  }
  const Metric = METRIC[widget.id];
  if (Metric) return <Metric widget={widget} />;
  const Personal = PERSONAL[widget.id];
  return Personal ? <Personal /> : null;
}

function renderWidgetFallback({ reset }: { reset: () => void }) {
  return (
    <WidgetCard title="Widget unavailable" compact>
      <button
        type="button"
        onClick={reset}
        className="text-xs font-medium text-primary hover:text-primary/80"
      >
        Try again
      </button>
    </WidgetCard>
  );
}

/** One catalog widget at the size the viewer chose; a crash stays inside its own card. */
export function DashboardWidgetView({ widget }: { widget: DashboardWidget }) {
  return (
    <WidgetSizeContext.Provider value={widget.size}>
      <ErrorBoundary fallback={renderWidgetFallback}>
        <WidgetBody widget={widget} />
      </ErrorBoundary>
    </WidgetSizeContext.Provider>
  );
}
