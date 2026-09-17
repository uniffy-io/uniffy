export type FieldType =
  | "text"
  | "number"
  | "single_select"
  | "multi_select"
  | "date"
  | "person"
  | "reference";

/** The stage a status stands for; the backend decides completion from it, never from the id. */
export type TaskStatusSemantic = "todo" | "in_progress" | "review" | "completed";

export interface SelectOption {
  id: string;
  label: string;
  color: string;
  sortOrder: number;
  /** Set on status options only. */
  semantic?: TaskStatusSemantic;
}

export interface FieldConfig {
  options?: SelectOption[];
  allowedTypes?: string[];
  format?: "date" | "datetime";
  includeTime?: boolean;
  min?: number;
  max?: number;
  precision?: number;
  prefix?: string;
  suffix?: string;
  allowMultiple?: boolean;
}

export interface FieldDefinition {
  id: string;
  projectId: string;
  name: string;
  type: FieldType;
  isRequired: boolean;
  /** True for built-in fields like Title, Status, Priority. */
  isSystem: boolean;
  sortOrder: number;
  config: FieldConfig;
  createdAt: string;
  updatedAt: string;
}

export type FieldValue = string | number | string[] | null;

export interface FieldTypeInfo {
  type: FieldType;
  label: string;
  description: string;
  icon: string;
  color: string;
  isSpecial?: boolean;
}

export const FIELD_TYPES: FieldTypeInfo[] = [
  {
    type: "text",
    label: "Text",
    description: "Single line of text",
    icon: "T",
    color: "#3b82f6",
  },
  {
    type: "number",
    label: "Number",
    description: "Numeric values, supports sum",
    icon: "#",
    color: "#8b5cf6",
  },
  {
    type: "single_select",
    label: "Single-select",
    description: "Dropdown with one choice",
    icon: "▼",
    color: "#22c55e",
  },
  {
    type: "multi_select",
    label: "Multi-select",
    description: "Tags with multiple choices",
    icon: "☰",
    color: "#f59e0b",
  },
  {
    type: "date",
    label: "Date",
    description: "Date picker, usable in Roadmap",
    icon: "calendar",
    color: "#ec4899",
  },
  {
    type: "person",
    label: "Person",
    description: "Assign team members",
    icon: "person",
    color: "#06b6d4",
  },
  {
    type: "reference",
    label: "Reference",
    description: "Link to Notes, Files, Chats...",
    icon: "@",
    color: "#3b82f6",
    isSpecial: true,
  },
];

export const SYSTEM_FIELD_IDS = {
  TITLE: "field_title",
  STATUS: "field_status",
  PRIORITY: "field_priority",
  ASSIGNEE: "field_assignee",
  START_DATE: "field_start_date",
  DUE_DATE: "field_due_date",
} as const;

// Mirrors the backend defaults; the hex is the brand-axis start for each slot and is only a
// courtesy for readers that cannot derive paint from order (see utils/statusPaint.ts).
export const DEFAULT_STATUS_OPTIONS: SelectOption[] = [
  { id: "status_todo", label: "To Do", color: "#694aff", sortOrder: 0, semantic: "todo" },
  {
    id: "status_in_progress",
    label: "In Progress",
    color: "#8c56fa",
    sortOrder: 1,
    semantic: "in_progress",
  },
  { id: "status_review", label: "Review", color: "#ae62f5", sortOrder: 2, semantic: "review" },
  { id: "status_done", label: "Done", color: "#d16ef0", sortOrder: 3, semantic: "completed" },
];

export const DEFAULT_PRIORITY_OPTIONS: SelectOption[] = [
  { id: "priority_low", label: "Low", color: "#22c55e", sortOrder: 0 },
  { id: "priority_medium", label: "Medium", color: "#f59e0b", sortOrder: 1 },
  { id: "priority_high", label: "High", color: "#ef4444", sortOrder: 2 },
  { id: "priority_urgent", label: "Urgent", color: "#dc2626", sortOrder: 3 },
];

export function createDefaultFieldDefinitions(projectId: string): FieldDefinition[] {
  const now = new Date().toISOString();

  return [
    {
      id: SYSTEM_FIELD_IDS.TITLE,
      projectId,
      name: "Title",
      type: "text",
      isRequired: true,
      isSystem: true,
      sortOrder: 0,
      config: {},
      createdAt: now,
      updatedAt: now,
    },
    {
      id: SYSTEM_FIELD_IDS.STATUS,
      projectId,
      name: "Status",
      type: "single_select",
      isRequired: true,
      isSystem: true,
      sortOrder: 1,
      config: { options: DEFAULT_STATUS_OPTIONS },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: SYSTEM_FIELD_IDS.PRIORITY,
      projectId,
      name: "Priority",
      type: "single_select",
      isRequired: false,
      isSystem: true,
      sortOrder: 2,
      config: { options: DEFAULT_PRIORITY_OPTIONS },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: SYSTEM_FIELD_IDS.ASSIGNEE,
      projectId,
      name: "Assignee",
      type: "person",
      isRequired: false,
      isSystem: true,
      sortOrder: 3,
      config: { allowMultiple: true },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: SYSTEM_FIELD_IDS.START_DATE,
      projectId,
      name: "Start Date",
      type: "date",
      isRequired: false,
      isSystem: true,
      sortOrder: 4,
      config: { format: "date" },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: SYSTEM_FIELD_IDS.DUE_DATE,
      projectId,
      name: "Due Date",
      type: "date",
      isRequired: false,
      isSystem: true,
      sortOrder: 5,
      config: { format: "date" },
      createdAt: now,
      updatedAt: now,
    },
  ];
}
