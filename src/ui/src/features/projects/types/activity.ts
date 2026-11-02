export type ActivityAction =
  | "created"
  | "title_changed"
  | "description_edited"
  | "status_changed"
  | "priority_changed"
  | "type_changed"
  | "assigned"
  | "start_date_changed"
  | "due_date_changed"
  | "sprint_changed"
  | "estimate_changed"
  | "parent_changed"
  | "recurrence_changed"
  | "milestone_changed"
  | "tags_changed"
  | "field_updated"
  | "blocked_by_added"
  | "blocked_by_removed"
  | "blocking_added"
  | "blocking_removed"
  | "time_logged"
  | "time_updated"
  | "time_removed"
  | "unknown";

export interface TaskActivity {
  id: string;
  taskId: string;
  /** The person the change is credited to; for agent changes, the person the agent acted for. */
  actorId: string;
  agentId?: string;
  agentName?: string;
  action: ActivityAction;
  timestamp: string;
  fieldId?: string;
  previousValue?: string;
  newValue?: string;
}
