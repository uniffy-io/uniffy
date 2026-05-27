
export type ActivityAction =
  | 'created'
  | 'status_changed'
  | 'priority_changed'
  | 'field_updated'
  | 'blocked_by_added'
  | 'blocked_by_removed'
  | 'assigned'
  | 'type_changed'
  | 'sprint_changed';

export interface TaskActivity {
  id: string;
  taskId: string;
  actorId: string;
  action: ActivityAction;
  timestamp: string;
  fieldId?: string;
  previousValue?: unknown;
  newValue?: unknown;
}
