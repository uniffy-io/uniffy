import { useEffect } from "react";
import {
  UserCircle,
  CheckCircle,
  PencilSimple,
  Clock,
  ShieldWarning,
} from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { selectActivitiesForTask } from "@/features/projects/store/projectsSlice";
import { fetchActivities } from "@/features/projects/store/projectsThunks";
import type { TaskActivity, ActivityAction } from "@/features/projects/types/activity";

interface ActivityLogProps {
  taskId: string;
}

export function ActivityLog({ taskId }: ActivityLogProps) {
  const dispatch = useAppDispatch();
  const activities = useAppSelector(selectActivitiesForTask(taskId));

  useEffect(() => {
    dispatch(fetchActivities(taskId));
  }, [dispatch, taskId]);

  const sorted = [...activities].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return (
    <div className="space-y-4 pt-4 border-t border-border">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Activity
      </h3>

      <div className="space-y-4 pl-2">
        {sorted.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">
            No recent activity
          </div>
        ) : (
          sorted.map((activity) => (
            <ActivityItem key={activity.id} activity={activity} />
          ))
        )}
      </div>
    </div>
  );
}

interface ActivityItemProps {
  activity: TaskActivity;
}

function ActivityItem({ activity }: ActivityItemProps) {
  const timeAgo = formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true });

  return (
    <div className="flex gap-3 text-sm">
      <div className="mt-0.5 text-muted-foreground">
        {renderActivityIcon(activity.action)}
      </div>
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">User {activity.actorId.split("-")[1]}</span>
          <span className="text-muted-foreground text-xs">{timeAgo}</span>
        </div>
        <div className="text-foreground">
          {renderActivityContent(activity)}
        </div>
      </div>
    </div>
  );
}

function renderActivityIcon(action: ActivityAction) {
  switch (action) {
    case "created": return <UserCircle size={16} />;
    case "status_changed": return <CheckCircle size={16} />;
    case "priority_changed": return <ShieldWarning size={16} />;
    case "field_updated": return <PencilSimple size={16} />;
    case "blocked_by_added":
    case "blocked_by_removed": return <Clock size={16} />;
    case "assigned": return <UserCircle size={16} />;
    default: return <PencilSimple size={16} />;
  }
}

function renderActivityContent(activity: TaskActivity) {
  switch (activity.action) {
    case "created":
      return "created this task";
    case "status_changed":
      return (
        <span>
          changed status from <span className="font-medium">{formatValue(activity.previousValue)}</span> to <span className="font-medium">{formatValue(activity.newValue)}</span>
        </span>
      );
    case "priority_changed":
      return (
        <span>
          changed to <span className="font-medium">{formatValue(activity.newValue)}</span> priority
        </span>
      );
    case "assigned":
      return <span>assigned to <span className="font-medium">{formatValue(activity.newValue)}</span></span>;
    case "blocked_by_added":
      return <span>added dependency on <span className="font-medium">{formatValue(activity.newValue)}</span></span>;
    case "blocked_by_removed":
      return <span>removed dependency on <span className="font-medium">{formatValue(activity.previousValue)}</span></span>;
    case "field_updated":
      return (
        <span>
          updated {activity.fieldId} from <span className="font-medium">{formatValue(activity.previousValue)}</span> to <span className="font-medium">{formatValue(activity.newValue)}</span>
        </span>
      );
    default:
      return "updated the task";
  }
}

function formatValue(val: unknown): string {
  if (typeof val === "string") {
    if (val.startsWith("status_")) return val.replace("status_", "").replace("_", " ");
    if (val.startsWith("priority_")) return val.replace("priority_", "").replace("_", " ");
    if (val.startsWith("user-")) return `User ${val.split("-")[1]}`;
    if (val.startsWith("task-")) return `Task ${val.split("-")[1]}`;
    return val;
  }
  return String(val);
}
