
export type ActivityAction =
  | 'created'
  | 'status_changed'
  | 'priority_changed'
  | 'field_updated'
  | 'blocked_by_added'
  | 'blocked_by_removed'
  | 'assigned';

export interface TaskActivity {
  id: string;
  taskId: string;
  actorId: string; // User ID
  action: ActivityAction;
  timestamp: string;

  // For structured diffs
  fieldId?: string; // If field_updated
  previousValue?: unknown;
  newValue?: unknown;
}
