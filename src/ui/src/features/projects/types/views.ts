import { SYSTEM_FIELD_IDS } from "./fields";

export type ViewType = "table" | "board" | "roadmap" | "backlog" | "graph" | "resources";

export type SortDirection = "asc" | "desc";

export type RoadmapZoomLevel = "day" | "week" | "month";

export interface TableViewConfig {
  type: "table";
  visibleFieldIds: string[];
  columnWidths: Record<string, number>;
  sortFieldId: string | null;
  sortDirection: SortDirection;
  groupByFieldId: string | null;
}

export interface BoardViewConfig {
  type: "board";
  statusFieldId: string;
  visibleFieldIds: string[];
  collapsedColumnIds: string[];
}

export interface RoadmapViewConfig {
  type: "roadmap";
  startDateFieldId: string;
  endDateFieldId: string;
  zoomLevel: RoadmapZoomLevel;
  visibleFieldIds: string[];
}

export type ViewSpecificConfig = TableViewConfig | BoardViewConfig | RoadmapViewConfig;

export interface ViewConfig {
  id: string;
  projectId: string;
  name: string;
  type: ViewType;
  isDefault: boolean;
  config: ViewSpecificConfig;
  createdAt: string;
  updatedAt: string;
}

export type FilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "is_empty"
  | "is_not_empty"
  | "greater_than"
  | "less_than"
  | "between";

export interface FilterCondition {
  id: string;
  fieldId: string;
  operator: FilterOperator;
  value: string | number | string[] | null;
}

export interface FilterConfig {
  conditions: FilterCondition[];
  logic: "and" | "or";
}

export interface SortConfig {
  fieldId: string;
  direction: SortDirection;
}

export function createDefaultViews(projectId: string): ViewConfig[] {
  const now = new Date().toISOString();

  const defaultVisibleFields = [
    SYSTEM_FIELD_IDS.TITLE,
    SYSTEM_FIELD_IDS.STATUS,
    SYSTEM_FIELD_IDS.PRIORITY,
    SYSTEM_FIELD_IDS.ASSIGNEE,
    SYSTEM_FIELD_IDS.DUE_DATE,
  ];

  return [
    {
      id: `${projectId}_view_table`,
      projectId,
      name: "Default Table",
      type: "table",
      isDefault: true,
      config: {
        type: "table",
        visibleFieldIds: [...defaultVisibleFields, SYSTEM_FIELD_IDS.START_DATE],
        columnWidths: {
          [SYSTEM_FIELD_IDS.TITLE]: 300,
          [SYSTEM_FIELD_IDS.STATUS]: 120,
          [SYSTEM_FIELD_IDS.PRIORITY]: 100,
          [SYSTEM_FIELD_IDS.ASSIGNEE]: 150,
          [SYSTEM_FIELD_IDS.START_DATE]: 120,
          [SYSTEM_FIELD_IDS.DUE_DATE]: 120,
        },
        sortFieldId: null,
        sortDirection: "asc",
        groupByFieldId: null,
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `${projectId}_view_board`,
      projectId,
      name: "Default Board",
      type: "board",
      isDefault: false,
      config: {
        type: "board",
        statusFieldId: SYSTEM_FIELD_IDS.STATUS,
        visibleFieldIds: [
          SYSTEM_FIELD_IDS.PRIORITY,
          SYSTEM_FIELD_IDS.ASSIGNEE,
          SYSTEM_FIELD_IDS.DUE_DATE,
        ],
        collapsedColumnIds: [],
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `${projectId}_view_roadmap`,
      projectId,
      name: "Default Roadmap",
      type: "roadmap",
      isDefault: false,
      config: {
        type: "roadmap",
        startDateFieldId: SYSTEM_FIELD_IDS.START_DATE,
        endDateFieldId: SYSTEM_FIELD_IDS.DUE_DATE,
        zoomLevel: "week",
        visibleFieldIds: [SYSTEM_FIELD_IDS.ASSIGNEE],
      },
      createdAt: now,
      updatedAt: now,
    },
  ];
}
