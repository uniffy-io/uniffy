import { useEffect, useMemo } from "react";
import {
  CheckCircle,
  PencilSimple,
  Clock,
  ShieldWarning,
  PlusCircle,
  ArrowsLeftRight,
} from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { selectActivitiesForTask } from "@/features/projects/store/projectsSlice";
import { fetchActivities } from "@/features/projects/store/projectsThunks";
import { SubjectAvatar } from "@/components/subject";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";
import type { Subject } from "@/components/subject/types";
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

  const sorted = useMemo(
    () => [...activities].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    ),
    [activities]
  );

  // Collect all unique actor IDs to resolve in one batch
  const actorIds = useMemo(
    () => [...new Set(sorted.map((a) => a.actorId))],
    [sorted]
  );
  const { subjects } = useSubjectResolver(actorIds);
  const actorMap = useMemo(() => {
    const map: Record<string, (typeof subjects)[number]> = {};
    for (const s of subjects) {
      map[s.id] = s;
    }
    return map;
  }, [subjects]);

  return (
    <div className="space-y-4 pt-4 border-t border-border">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Activity
      </h3>

      <div className="space-y-3 pl-2">
        {sorted.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">
            No recent activity
          </div>
        ) : (
          sorted.map((activity) => (
            <ActivityItem
              key={activity.id}
              activity={activity}
              actorName={actorMap[activity.actorId]?.name}
              actorSubject={actorMap[activity.actorId]}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface ActivityItemProps {
  activity: TaskActivity;
  actorName?: string;
  actorSubject?: Subject;
}

function ActivityItem({ activity, actorName, actorSubject }: ActivityItemProps) {
  const timeAgo = formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true });

  return (
    <div className="flex gap-2.5 text-sm">
      {/* User avatar */}
      <div className="mt-0.5 shrink-0">
        {actorSubject ? (
          <SubjectAvatar subject={actorSubject} size="xs" />
        ) : (
          <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center">
            <span className="text-[8px] text-muted-foreground font-medium">?</span>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium text-foreground text-xs">
            {actorName || "Unknown user"}
          </span>
          <span className="text-muted-foreground/60 shrink-0">
            {renderActivityIcon(activity.action)}
          </span>
          <span className="text-foreground text-xs">
            {renderActivityContent(activity)}
          </span>
          <span className="text-muted-foreground text-[10px] shrink-0">{timeAgo}</span>
        </div>
      </div>
    </div>
  );
}

function renderActivityIcon(action: ActivityAction) {
  switch (action) {
    case "created": return <PlusCircle size={12} />;
    case "status_changed": return <CheckCircle size={12} />;
    case "priority_changed": return <ShieldWarning size={12} />;
    case "field_updated": return <PencilSimple size={12} />;
    case "blocked_by_added":
    case "blocked_by_removed": return <Clock size={12} />;
    case "assigned": return <ArrowsLeftRight size={12} />;
    case "type_changed": return <PencilSimple size={12} />;
    case "sprint_changed": return <ArrowsLeftRight size={12} />;
    default: return <PencilSimple size={12} />;
  }
}

function renderActivityContent(activity: TaskActivity) {
  switch (activity.action) {
    case "created":
      return "created this task";
    case "status_changed":
      return (
        <span>
          changed status to <span className="font-medium">{formatValue(activity.newValue)}</span>
        </span>
      );
    case "priority_changed":
      return (
        <span>
          set priority to <span className="font-medium">{formatValue(activity.newValue)}</span>
        </span>
      );
    case "assigned":
      return "updated assignees";
    case "blocked_by_added":
      return "added a dependency";
    case "blocked_by_removed":
      return "removed a dependency";
    case "type_changed":
      return (
        <span>
          changed type to <span className="font-medium">{formatValue(activity.newValue)}</span>
        </span>
      );
    case "sprint_changed":
      return "moved to another sprint";
    case "field_updated":
      return (
        <span>
          updated <span className="font-medium">{activity.fieldId?.replace("field_", "") || "a field"}</span>
        </span>
      );
    default:
      return "updated the task";
  }
}

function formatValue(val: unknown): string {
  if (typeof val === "string") {
    if (val.startsWith("status_")) return val.replace("status_", "").replace(/_/g, " ");
    if (val.startsWith("priority_")) return val.replace("priority_", "").replace(/_/g, " ");
    return val;
  }
  return String(val);
}
