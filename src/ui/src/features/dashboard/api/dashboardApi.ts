import { createClient } from "@connectrpc/connect";
import { unaryTransport } from "@/config/api";
import { healthStats } from "@/features/projects/utils/projectHealth";
import { SettingsService } from "@uniffy/proto/settings/v1/settings_pb";
import {
  DashboardPeopleScope,
  DashboardProjectScope,
  DashboardSprintScope,
  DashboardWidgetSize,
  type Dashboard as ProtoDashboard,
  type DashboardDefinition as ProtoDefinition,
} from "@uniffy/proto/settings/v1/dashboard_pb";
import { ProjectsService } from "@uniffy/proto/projects/v1/projects_pb";
import {
  MetricPeopleScope,
  MetricProjectScope,
  MetricSprintScope,
  TaskMetric,
  type GetTaskMetricsResponse,
} from "@uniffy/proto/projects/v1/metrics_pb";
import type {
  DashboardCatalog,
  DashboardDefinition,
  PeopleScope,
  ProjectScope,
  SavedDashboard,
  SprintScope,
  TaskMetricKind,
  TaskMetrics,
  WidgetFilters,
  WidgetSize,
} from "@/features/dashboard/types";

const settingsClient = createClient(SettingsService, unaryTransport);
const projectsClient = createClient(ProjectsService, unaryTransport);

const PROJECTS: Record<ProjectScope, DashboardProjectScope> = {
  all: DashboardProjectScope.ALL,
  my_projects: DashboardProjectScope.MY_PROJECTS,
  selected: DashboardProjectScope.SELECTED,
};
const PEOPLE: Record<PeopleScope, DashboardPeopleScope> = {
  everyone: DashboardPeopleScope.EVERYONE,
  me: DashboardPeopleScope.ME,
  my_teams: DashboardPeopleScope.MY_TEAMS,
};
const SPRINT: Record<SprintScope, DashboardSprintScope> = {
  any: DashboardSprintScope.ANY,
  active: DashboardSprintScope.ACTIVE,
};
const SIZE: Record<WidgetSize, DashboardWidgetSize> = {
  compact: DashboardWidgetSize.COMPACT,
  expanded: DashboardWidgetSize.EXPANDED,
};

function invert<K extends string, V extends number>(map: Record<K, V>): Map<V, K> {
  return new Map(Object.entries(map).map(([key, value]) => [value as V, key as K]));
}

const PROJECTS_FROM = invert(PROJECTS);
const PEOPLE_FROM = invert(PEOPLE);
const SPRINT_FROM = invert(SPRINT);
const SIZE_FROM = invert(SIZE);

function definitionFromProto(definition: ProtoDefinition): DashboardDefinition {
  return {
    preset: definition.preset,
    name: definition.name,
    widgets: definition.widgets.map((widget) => ({
      id: widget.widgetId,
      visible: widget.visible,
      size: SIZE_FROM.get(widget.size) ?? "expanded",
      filters: {
        projects: PROJECTS_FROM.get(widget.filters?.projects ?? 0) ?? "all",
        projectIds: widget.filters?.projectIds ?? [],
        people: PEOPLE_FROM.get(widget.filters?.people ?? 0) ?? "everyone",
        sprint: SPRINT_FROM.get(widget.filters?.sprint ?? 0) ?? "any",
      },
      unsupportedFilters: widget.unsupportedFilters,
    })),
  };
}

function definitionToProto(definition: DashboardDefinition) {
  return {
    version: 1,
    preset: definition.preset,
    name: definition.name,
    widgets: definition.widgets.map((widget) => ({
      widgetId: widget.id,
      visible: widget.visible,
      size: SIZE[widget.size],
      filters: {
        projects: PROJECTS[widget.filters.projects],
        projectIds: widget.filters.projects === "selected" ? widget.filters.projectIds : [],
        people: PEOPLE[widget.filters.people],
        sprint: SPRINT[widget.filters.sprint],
      },
    })),
  };
}

function dashboardFromProto(dashboard: ProtoDashboard | undefined): SavedDashboard {
  return {
    definition: dashboard?.definition ? definitionFromProto(dashboard.definition) : null,
    revision: Number(dashboard?.revision ?? 0),
    hasPrevious: dashboard?.hasPrevious ?? false,
  };
}

const METRIC: Record<TaskMetricKind, TaskMetric> = {
  sprint_progress: TaskMetric.SPRINT_PROGRESS,
  overdue: TaskMetric.OVERDUE,
  blocked: TaskMetric.BLOCKED,
  workload: TaskMetric.WORKLOAD,
  status_by_project: TaskMetric.STATUS_BY_PROJECT,
  bug_trend: TaskMetric.BUG_TREND,
  review_queue: TaskMetric.REVIEW_QUEUE,
};
const METRIC_PROJECTS: Record<ProjectScope, MetricProjectScope> = {
  all: MetricProjectScope.ALL,
  my_projects: MetricProjectScope.MY_PROJECTS,
  selected: MetricProjectScope.SELECTED,
};
const METRIC_PEOPLE: Record<PeopleScope, MetricPeopleScope> = {
  everyone: MetricPeopleScope.EVERYONE,
  me: MetricPeopleScope.ME,
  my_teams: MetricPeopleScope.MY_TEAMS,
};
const METRIC_SPRINT: Record<SprintScope, MetricSprintScope> = {
  any: MetricSprintScope.ANY,
  active: MetricSprintScope.ACTIVE,
};

function metricsFromProto(response: GetTaskMetricsResponse): TaskMetrics {
  return {
    total: response.total,
    items: response.items.map((item) => ({
      taskId: item.taskId,
      projectId: item.projectId,
      number: item.number,
      title: item.title,
      dueDate: item.dueDate,
      assigneeIds: item.assigneeIds,
      status: item.status,
    })),
    workload: response.workload.map((row) => ({ ...row })),
    statusByProject: response.statusByProject.map((row) => ({
      projectId: row.projectId,
      todo: row.todo,
      inProgress: row.inProgress,
      review: row.review,
      completed: row.completed,
      health: healthStats(
        row.topLevelTotal,
        row.topLevelCompleted,
        row.overdue,
        Number(row.estimatedMinutes),
        Number(row.timeSpentMinutes),
      ),
    })),
    bugTrend: response.bugTrend.map((point) => ({
      date: point.date,
      opened: point.opened,
      closed: point.closed,
    })),
    sprints: response.sprints.map((sprint) => ({
      sprintId: sprint.sprintId,
      projectId: sprint.projectId,
      name: sprint.name,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      total: sprint.total,
      completed: sprint.completed,
      burndown: sprint.burndown.map((point) => ({
        date: point.date,
        remaining: point.remaining,
      })),
    })),
    projects: Object.fromEntries(
      response.projects.map((project) => [project.id, { name: project.name, slug: project.slug }]),
    ),
  };
}

export const dashboardApi = {
  getCatalog: async (): Promise<DashboardCatalog> => {
    const response = await settingsClient.getDashboardCatalog({});
    return {
      widgets: response.widgets.map((widget) => ({
        id: widget.widgetId,
        label: widget.label,
        description: widget.description,
        filterable: widget.filterable,
        defaultSize: SIZE_FROM.get(widget.defaultSize) ?? "expanded",
      })),
      presets: response.presets.map((preset) => ({
        id: preset.presetId,
        label: preset.label,
        description: preset.description,
        definition: preset.definition
          ? definitionFromProto(preset.definition)
          : { widgets: [], preset: preset.presetId, name: preset.label },
      })),
      defaultDefinition: response.defaultDefinition
        ? definitionFromProto(response.defaultDefinition)
        : { widgets: [], preset: "", name: "" },
    };
  },

  getDashboard: async (organizationId: string): Promise<SavedDashboard> => {
    const response = await settingsClient.getDashboard({ organizationId });
    return dashboardFromProto(response.dashboard);
  },

  saveDashboard: async (
    organizationId: string,
    definition: DashboardDefinition,
    expectedRevision: number,
    keepPrevious: boolean,
  ): Promise<SavedDashboard> => {
    const response = await settingsClient.saveDashboard({
      organizationId,
      definition: definitionToProto(definition),
      expectedRevision: BigInt(expectedRevision),
      keepPrevious,
    });
    return dashboardFromProto(response.dashboard);
  },

  restorePrevious: async (
    organizationId: string,
    expectedRevision: number,
  ): Promise<SavedDashboard> => {
    const response = await settingsClient.restorePreviousDashboard({
      organizationId,
      expectedRevision: BigInt(expectedRevision),
    });
    return dashboardFromProto(response.dashboard);
  },

  getTaskMetrics: async (
    organizationId: string,
    metric: TaskMetricKind,
    filters: WidgetFilters,
    timeZone: string,
    limit?: number,
  ): Promise<TaskMetrics> => {
    const response = await projectsClient.getTaskMetrics({
      organizationId,
      metric: METRIC[metric],
      scope: {
        projects: METRIC_PROJECTS[filters.projects],
        projectIds: filters.projects === "selected" ? filters.projectIds : [],
        people: METRIC_PEOPLE[filters.people],
        sprint: METRIC_SPRINT[filters.sprint],
      },
      limit: limit ?? 0,
      timeZone,
    });
    return metricsFromProto(response);
  },
};
