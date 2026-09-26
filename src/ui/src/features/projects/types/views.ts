import type {
  FilterLogic,
  RelativeDateAnchor,
  RoadmapZoom,
  SortDirection as ViewSortDirection,
  TaskFilterOperator,
  TaskPseudoField,
  ViewVisibility,
} from "@uniffy/proto/projects/v1/projects_pb";
import type { FieldType } from "./fields";

export type ViewType = "table" | "board" | "roadmap" | "backlog" | "graph" | "resources";

export type SortDirection = "asc" | "desc";

export type RoadmapZoomLevel = "day" | "week" | "month";

/** A project field (system or custom) or a task attribute the backend defines. */
export type ViewFieldRef =
  | { kind: "field"; fieldId: string }
  | { kind: "pseudo"; pseudo: TaskPseudoField };

export interface ViewFilterIdSet {
  ids: string[];
  includeCurrentUser: boolean;
  includeEmpty: boolean;
  includeActiveSprint: boolean;
}

/** `date` is YYYY-MM-DD; relative dates resolve when the filter is evaluated. */
export type ViewFilterDate =
  | { kind: "fixed"; date: string }
  | { kind: "relative"; anchor: RelativeDateAnchor; offsetDays: number };

export type ViewFilterValue =
  | { kind: "ids"; ids: ViewFilterIdSet }
  | { kind: "text"; text: string }
  | { kind: "number"; number: number }
  | { kind: "numberRange"; min: number; max: number }
  | { kind: "date"; date: ViewFilterDate }
  | { kind: "dateRange"; start: ViewFilterDate; end: ViewFilterDate }
  | { kind: "flag"; flag: boolean };

export interface ViewFilterCondition {
  field: ViewFieldRef;
  operator: TaskFilterOperator;
  value: ViewFilterValue | null;
}

export type ViewFilterNode =
  | { kind: "condition"; condition: ViewFilterCondition }
  | { kind: "group"; group: ViewFilterGroup };

export interface ViewFilterGroup {
  logic: FilterLogic;
  nodes: ViewFilterNode[];
}

export interface ViewSortKey {
  field: ViewFieldRef;
  direction: ViewSortDirection;
}

export interface ViewGroupBy {
  field: ViewFieldRef;
  direction: ViewSortDirection;
  hideEmpty: boolean;
}

export type ViewLayout =
  | { type: "table"; flat: boolean }
  | { type: "board"; columnFieldId: string }
  | { type: "roadmap"; zoom: RoadmapZoom }
  | { type: "backlog" }
  | { type: "graph"; hideParentEdges: boolean }
  | { type: "resources" };

export interface ViewColumnWidth {
  field: ViewFieldRef;
  width: number;
}

export interface ViewDefinition {
  layout: ViewLayout;
  filter: ViewFilterGroup | null;
  sort: ViewSortKey[];
  groupBy: ViewGroupBy | null;
  visibleFields: ViewFieldRef[];
  columnWidths: ViewColumnWidth[];
  collapsedGroupKeys: string[];
}

export interface ViewConfig {
  id: string;
  projectId: string;
  name: string;
  type: ViewType;
  definition: ViewDefinition;
  ownerId: string;
  visibility: ViewVisibility;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type ViewIdFlag = "includeCurrentUser" | "includeEmpty" | "includeActiveSprint";

/** What a view may do with one field, as the server's definition validator allows it. */
export interface ViewFieldCapabilities {
  operators: TaskFilterOperator[];
  idFlags: ViewIdFlag[];
  sortable: boolean;
  groupable: boolean;
}

export interface ViewFilterLimits {
  /** The top-level group counts as the first level. */
  maxDepth: number;
  maxNodes: number;
  maxIdsPerCondition: number;
  maxTextLength: number;
  maxRelativeOffsetDays: number;
}

export interface ViewCatalog {
  fieldTypes: Partial<Record<FieldType, ViewFieldCapabilities>>;
  /** Keyed by `TaskPseudoField`. */
  pseudoFields: Partial<Record<number, ViewFieldCapabilities>>;
  filterLimits: ViewFilterLimits;
}
