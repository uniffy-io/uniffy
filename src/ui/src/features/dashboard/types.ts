export type ProjectScope = "all" | "my_projects" | "selected";
export type PeopleScope = "everyone" | "me" | "my_teams";
export type SprintScope = "any" | "active";
export type WidgetSize = "compact" | "expanded";

/** Relative tokens resolve on the server for whoever opens the dashboard. */
export interface WidgetFilters {
  projects: ProjectScope;
  projectIds: string[];
  people: PeopleScope;
  sprint: SprintScope;
}

export interface DashboardWidget {
  id: string;
  visible: boolean;
  size: WidgetSize;
  filters: WidgetFilters;
  /** Filters a stored layout carries that this version cannot apply. */
  unsupportedFilters: string[];
}

export interface DashboardDefinition {
  widgets: DashboardWidget[];
  /** The template this layout came from, empty for a hand-made one. */
  preset: string;
  /** What the viewer calls this dashboard; empty shows no title. */
  name: string;
}

export interface SavedDashboard {
  /** Null until the viewer saves a layout; the catalog default shows instead. */
  definition: DashboardDefinition | null;
  revision: number;
  hasPrevious: boolean;
}

export interface WidgetType {
  id: string;
  label: string;
  description: string;
  filterable: boolean;
  defaultSize: WidgetSize;
}

export interface DashboardPreset {
  id: string;
  label: string;
  description: string;
  definition: DashboardDefinition;
}

export interface DashboardCatalog {
  widgets: WidgetType[];
  presets: DashboardPreset[];
  defaultDefinition: DashboardDefinition;
}

export type TaskMetricKind =
  | "sprint_progress"
  | "overdue"
  | "blocked"
  | "workload"
  | "status_by_project"
  | "bug_trend"
  | "review_queue";

export interface MetricTask {
  taskId: string;
  projectId: string;
  number: number;
  title: string;
  dueDate: string;
  assigneeIds: string[];
  status: string;
}

export interface WorkloadEntry {
  userId: string;
  open: number;
  overdue: number;
}

export interface ProjectStatusCounts {
  projectId: string;
  todo: number;
  inProgress: number;
  review: number;
  completed: number;
}

export interface BugTrendDay {
  date: string;
  opened: number;
  closed: number;
}

export interface SprintProgress {
  sprintId: string;
  projectId: string;
  name: string;
  startDate: string;
  endDate: string;
  total: number;
  completed: number;
  burndown: { date: string; remaining: number }[];
}

export interface TaskMetrics {
  total: number;
  items: MetricTask[];
  workload: WorkloadEntry[];
  statusByProject: ProjectStatusCounts[];
  bugTrend: BugTrendDay[];
  sprints: SprintProgress[];
}

export const DEFAULT_FILTERS: WidgetFilters = {
  projects: "all",
  projectIds: [],
  people: "everyone",
  sprint: "any",
};
