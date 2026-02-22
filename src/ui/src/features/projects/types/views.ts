import { SYSTEM_FIELD_IDS } from "./fields";

/**
 * Available view types
 */
export type ViewType = "table" | "board" | "roadmap" | "backlog" | "graph";

/**
 * Sort direction
 */
export type SortDirection = "asc" | "desc";

/**
 * Zoom level for roadmap view
 */
export type RoadmapZoomLevel = "day" | "week" | "month";

/**
 * Configuration specific to Table view
 */
export interface TableViewConfig {
  type: "table";
  visibleFieldIds: string[];
  columnWidths: Record<string, number>;
  sortFieldId: string | null;
  sortDirection: SortDirection;
  groupByFieldId: string | null;
}

/**
 * Configuration specific to Board view
 */
export interface BoardViewConfig {
  type: "board";
  statusFieldId: string; // Which field to use for columns
  visibleFieldIds: string[]; // Fields shown on cards
  collapsedColumnIds: string[]; // Which columns are collapsed
}

/**
 * Configuration specific to Roadmap view
 */
export interface RoadmapViewConfig {
  type: "roadmap";
  startDateFieldId: string;
  endDateFieldId: string;
  zoomLevel: RoadmapZoomLevel;
  visibleFieldIds: string[]; // Fields shown in task list
}

/**
 * Union of all view-specific configurations
 */
export type ViewSpecificConfig = TableViewConfig | BoardViewConfig | RoadmapViewConfig;

/**
 * A saved view configuration
 */
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

/**
 * Filter operator types
 */
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

/**
 * A single filter condition
 */
export interface FilterCondition {
  id: string;
  fieldId: string;
  operator: FilterOperator;
  value: string | number | string[] | null;
}

/**
 * Filter configuration with multiple conditions
 */
export interface FilterConfig {
  conditions: FilterCondition[];
  logic: "and" | "or";
}

/**
 * Sort configuration
 */
export interface SortConfig {
  fieldId: string;
  direction: SortDirection;
}

/**
 * Create default view configurations for a new project
 */
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
