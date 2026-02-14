/**
 * Available field types for project custom fields
 */
export type FieldType =
  | "text"
  | "number"
  | "single_select"
  | "multi_select"
  | "date"
  | "person"
  | "reference";

/**
 * Option for single/multi-select fields
 */
export interface SelectOption {
  id: string;
  label: string;
  color: string;
  sortOrder: number;
}

/**
 * Type-specific configuration for fields
 */
export interface FieldConfig {
  // For select fields
  options?: SelectOption[];

  // For reference fields - which content types are allowed
  allowedTypes?: string[]; // 'NOTE', 'FILE', 'CHAT', etc.

  // For date fields
  format?: "date" | "datetime";
  includeTime?: boolean;

  // For number fields
  min?: number;
  max?: number;
  precision?: number; // decimal places
  prefix?: string; // e.g., "$"
  suffix?: string; // e.g., "%"

  // For person fields
  allowMultiple?: boolean;
}

/**
 * Definition of a custom field in a project
 */
export interface FieldDefinition {
  id: string;
  projectId: string;
  name: string;
  type: FieldType;
  isRequired: boolean;
  isSystem: boolean; // True for Title, Status, Priority, etc.
  sortOrder: number;
  config: FieldConfig;
  createdAt: string;
  updatedAt: string;
}

/**
 * Possible values a field can hold
 */
export type FieldValue =
  | string // text, single_select, date
  | number // number
  | string[] // multi_select, person (multiple), reference
  | null;

/**
 * Field type metadata for UI display
 */
export interface FieldTypeInfo {
  type: FieldType;
  label: string;
  description: string;
  icon: string;
  color: string;
  isSpecial?: boolean; // For Reference field (UWOS unique)
}

/**
 * All available field types with their UI metadata
 */
export const FIELD_TYPES: FieldTypeInfo[] = [
  {
    type: "text",
    label: "Text",
    description: "Single line of text",
    icon: "T",
    color: "#3b82f6", // blue
  },
  {
    type: "number",
    label: "Number",
    description: "Numeric values, supports sum",
    icon: "#",
    color: "#8b5cf6", // violet
  },
  {
    type: "single_select",
    label: "Single-select",
    description: "Dropdown with one choice",
    icon: "▼",
    color: "#22c55e", // green
  },
  {
    type: "multi_select",
    label: "Multi-select",
    description: "Tags with multiple choices",
    icon: "☰",
    color: "#f59e0b", // amber
  },
  {
    type: "date",
    label: "Date",
    description: "Date picker, usable in Roadmap",
    icon: "calendar",
    color: "#ec4899", // pink
  },
  {
    type: "person",
    label: "Person",
    description: "Assign team members",
    icon: "person",
    color: "#06b6d4", // cyan
  },
  {
    type: "reference",
    label: "Reference",
    description: "Link to Notes, Files, Chats...",
    icon: "@",
    color: "#3b82f6", // blue
    isSpecial: true,
  },
];

/**
 * System field IDs that are always present
 */
export const SYSTEM_FIELD_IDS = {
  TITLE: "field_title",
  STATUS: "field_status",
  PRIORITY: "field_priority",
  ASSIGNEE: "field_assignee",
  START_DATE: "field_start_date",
  DUE_DATE: "field_due_date",
} as const;

/**
 * Default status options for new projects
 */
export const DEFAULT_STATUS_OPTIONS: SelectOption[] = [
  { id: "status_todo", label: "To Do", color: "#6b7280", sortOrder: 0 },
  { id: "status_in_progress", label: "In Progress", color: "#3b82f6", sortOrder: 1 },
  { id: "status_done", label: "Done", color: "#22c55e", sortOrder: 2 },
];

/**
 * Default priority options for new projects
 */
export const DEFAULT_PRIORITY_OPTIONS: SelectOption[] = [
  { id: "priority_low", label: "Low", color: "#22c55e", sortOrder: 0 },
  { id: "priority_medium", label: "Medium", color: "#f59e0b", sortOrder: 1 },
  { id: "priority_high", label: "High", color: "#ef4444", sortOrder: 2 },
  { id: "priority_urgent", label: "Urgent", color: "#dc2626", sortOrder: 3 },
];

/**
 * Create default field definitions for a new project
 */
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
