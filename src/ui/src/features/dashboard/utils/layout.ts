import {
  DEFAULT_FILTERS,
  type DashboardCatalog,
  type DashboardDefinition,
  type DashboardWidget,
  type PeopleScope,
  type ProjectScope,
  type SprintScope,
  type WidgetFilters,
  type WidgetSize,
} from "@/features/dashboard/types";

const TASK_LIST_WIDGETS = ["overdue-tasks", "blocked-tasks", "review-queue"] as const;
export type TaskListWidgetId = (typeof TASK_LIST_WIDGETS)[number];

/** Widgets that list tasks behind a headline count. */
export function isTaskListWidget(id: string): id is TaskListWidgetId {
  return (TASK_LIST_WIDGETS as readonly string[]).includes(id);
}

const PROJECT_SCOPES: readonly ProjectScope[] = ["all", "my_projects", "selected"];
const PEOPLE_SCOPES: readonly PeopleScope[] = ["everyone", "me", "my_teams"];
const SPRINT_SCOPES: readonly SprintScope[] = ["any", "active"];
const SIZES: readonly WidgetSize[] = ["compact", "expanded"];

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * The saved widgets in their order, then every other catalog widget hidden at the end, so the
 * customizer can switch on what a layout left out. Retired widget ids drop.
 */
export function fullLayout(
  definition: DashboardDefinition,
  catalog: DashboardCatalog,
): DashboardWidget[] {
  const known = new Map(catalog.widgets.map((widget) => [widget.id, widget]));
  const listed = definition.widgets.filter((widget) => known.has(widget.id));
  const present = new Set(listed.map((widget) => widget.id));
  const rest = catalog.widgets
    .filter((widget) => !present.has(widget.id))
    .map((widget) => ({
      id: widget.id,
      visible: false,
      size: widget.defaultSize,
      filters: { ...DEFAULT_FILTERS },
      unsupportedFilters: [],
    }));
  return [...listed, ...rest];
}

export function moveWidget(
  widgets: DashboardWidget[],
  from: number,
  to: number,
): DashboardWidget[] {
  if (from === to || from < 0 || to < 0 || from >= widgets.length || to >= widgets.length) {
    return widgets;
  }
  const next = [...widgets];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

const LEGACY_KEY_PREFIX = "uniffy_dashboard_layout_";

export function legacyLayoutKey(userId: string): string {
  return `${LEGACY_KEY_PREFIX}${userId}`;
}

/** Reads the layout older versions kept in this browser, so the first save carries it over. */
export function parseLegacyLayout(raw: string | null): DashboardDefinition | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const widgets: DashboardWidget[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as Record<string, unknown>;
      if (typeof record.id !== "string") continue;
      widgets.push({
        id: record.id,
        visible: record.visible !== false,
        size: pick(SIZES, record.size, "expanded"),
        filters: { ...DEFAULT_FILTERS },
        unsupportedFilters: [],
      });
    }
    return widgets.length ? { widgets, preset: "", name: "" } : null;
  } catch {
    return null;
  }
}

function storedFilters(raw: unknown): WidgetFilters {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_FILTERS };
  const record = raw as Record<string, unknown>;
  return {
    projects: pick(PROJECT_SCOPES, record.projects, "all"),
    projectIds: Array.isArray(record.project_ids)
      ? record.project_ids.filter((id): id is string => typeof id === "string")
      : [],
    people: pick(PEOPLE_SCOPES, record.people, "everyone"),
    sprint: pick(SPRINT_SCOPES, record.sprint, "any"),
  };
}

export interface DashboardProposal {
  organizationId: string;
  description: string;
  definition: DashboardDefinition;
}

/**
 * `tool_meta` of a `dashboard.propose` result. It crosses the wire as a JSON string inside the
 * message metadata map; anything that is not a dashboard proposal yields null.
 */
export function parseDashboardProposal(raw: unknown): DashboardProposal | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null) return null;
  const meta = value as Record<string, unknown>;
  if (meta.kind !== "dashboard_proposal") return null;
  const definition = meta.definition as Record<string, unknown> | undefined;
  if (!definition || !Array.isArray(definition.widgets)) return null;
  const widgets: DashboardWidget[] = definition.widgets.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== "string") return [];
    return [
      {
        id: record.id,
        visible: record.visible !== false,
        size: pick(SIZES, record.size, "expanded"),
        filters: storedFilters(record.filters),
        unsupportedFilters: [],
      },
    ];
  });
  const description = typeof meta.description === "string" ? meta.description : "";
  return {
    organizationId: typeof meta.organization_id === "string" ? meta.organization_id : "",
    description,
    definition: {
      widgets,
      preset: "",
      name: typeof definition.name === "string" && definition.name ? definition.name : description,
    },
  };
}

/** One widget's metric under its filters; equal filters share a cache entry. */
export function metricKey(widgetId: string, filters: WidgetFilters): string {
  const ids = filters.projects === "selected" ? [...filters.projectIds].sort().join(",") : "";
  return `${widgetId}|${filters.projects}|${ids}|${filters.people}|${filters.sprint}`;
}

const PROJECT_LABELS: Record<ProjectScope, string> = {
  all: "All projects",
  my_projects: "My projects",
  selected: "Selected projects",
};
const PEOPLE_LABELS: Record<PeopleScope, string> = {
  everyone: "Everyone",
  me: "Me",
  my_teams: "My teams",
};
const SPRINT_LABELS: Record<SprintScope, string> = {
  any: "Any sprint",
  active: "Active sprint",
};

export const FILTER_LABELS = {
  projects: PROJECT_LABELS,
  people: PEOPLE_LABELS,
  sprint: SPRINT_LABELS,
};

/** Short "My projects, me" line for a widget subtitle; empty when nothing narrows it. */
export function describeFilters(filters: WidgetFilters, projectNames: string[] = []): string {
  const parts: string[] = [];
  if (filters.projects === "selected") {
    parts.push(projectNames.length ? projectNames.join(", ") : PROJECT_LABELS.selected);
  } else if (filters.projects !== "all") {
    parts.push(PROJECT_LABELS[filters.projects]);
  }
  if (filters.people !== "everyone") parts.push(PEOPLE_LABELS[filters.people]);
  if (filters.sprint !== "any") parts.push(SPRINT_LABELS[filters.sprint]);
  return parts.join(" · ");
}
