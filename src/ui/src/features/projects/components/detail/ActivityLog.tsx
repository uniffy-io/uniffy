import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CheckCircle,
  PencilSimple,
  Clock,
  ShieldWarning,
  PlusCircle,
  ArrowsLeftRight,
  CalendarBlank,
  LinkSimple,
  Robot,
  Tag as TagIcon,
  Users,
  TextAa,
} from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { useContentRefresh } from "@/features/notifications/hooks/useContentRefresh";
import { fetchTaskAgents } from "@/features/projects/store/taskAgentsThunks";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import {
  selectActivitiesForTask,
  selectProjectById,
  selectTasksMap,
} from "@/features/projects/store/projectsSlice";
import { fetchActivities } from "@/features/projects/store/projectsThunks";
import { SubjectAvatar } from "@/components/subject";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";
import type { Subject } from "@/components/subject/types";
import { Select } from "@/components/ui/select";
import type { ActivityAction, TaskActivity } from "@/features/projects/types/activity";
import type {
  FieldDefinition,
  SelectOption as FieldOption,
} from "@/features/projects/types/fields";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types/fields";
import type { Sprint, Task } from "@/features/projects/types/project";
import { optionPaint } from "@/features/projects/utils/statusPaint";
import { getTaskTypeConfig } from "@/features/projects/utils/taskTypes";
import {
  ACTIVITY_CATEGORY_LABELS,
  activityCategory,
  listChange,
  mergeActivityRuns,
  parseNameList,
  splitList,
  type ActivityCategory,
  type ActivityEntry,
} from "@/features/projects/utils/activityPresentation";
import { formatMinutes } from "@/shared/utils/durationFormatting";
import { formatDateFull, formatDateTimeFull } from "@/shared/utils/dateFormatting";

interface ActivityLogProps {
  taskId: string;
  /** Show this many of the newest entries; the rest wait behind "Show N earlier". */
  maxInitialItems?: number;
  /** Chosen in the Activity section's header, which owns the heading and the filter. */
  filter: ActivityFilter;
}

export type ActivityFilter = ActivityCategory | "all";

const FILTER_OPTIONS = (Object.keys(ACTIVITY_CATEGORY_LABELS) as ActivityFilter[]).map((value) => ({
  value,
  label: ACTIVITY_CATEGORY_LABELS[value],
}));

interface Lookups {
  fields: Map<string, FieldDefinition>;
  tasks: Record<string, Task>;
  sprints: Record<string, Sprint>;
  people: Record<string, Subject>;
  agents: Record<string, string>;
}

/** The activity kind picker, for a section header that hosts an embedded log. */
export function ActivityFilterSelect({
  value,
  onChange,
}: {
  value: ActivityFilter;
  onChange: (value: ActivityFilter) => void;
}) {
  return (
    <Select<ActivityFilter>
      value={value}
      onChange={onChange}
      options={FILTER_OPTIONS}
      size="sm"
      menuMinWidth={190}
      ariaLabel="Filter activity"
    />
  );
}

export function ActivityLog({ taskId, maxInitialItems, filter }: ActivityLogProps) {
  const dispatch = useAppDispatch();
  const activities = useAppSelector(selectActivitiesForTask(taskId));
  const tasks = useAppSelector(selectTasksMap);
  const projectId = tasks[taskId]?.projectId;
  const project = useAppSelector(selectProjectById(projectId ?? ""));
  const sprints = useAppSelector((state) => state.sprints.sprints);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    dispatch(fetchActivities(taskId));
  }, [dispatch, taskId]);
  useContentRefresh(ContentType.TASK, taskId, () => {
    void dispatch(fetchActivities(taskId));
  });

  const entries = useMemo(() => {
    const newestFirst = [...activities].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    const filtered =
      filter === "all"
        ? newestFirst
        : newestFirst.filter((a) => activityCategory(a.action) === filter);
    return mergeActivityRuns(filtered);
  }, [activities, filter]);

  const visible = useMemo(() => {
    if (maxInitialItems == null || isExpanded) return entries;
    return entries.slice(0, maxInitialItems);
  }, [entries, maxInitialItems, isExpanded]);

  const hiddenCount = entries.length - visible.length;

  const personIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of visible) {
      ids.add(entry.actorId);
      if (entry.action === "assigned") {
        for (const change of [entry, ...entry.steps]) {
          for (const id of splitList(change.previousValue)) ids.add(id);
          for (const id of splitList(change.newValue)) ids.add(id);
        }
      }
    }
    return [...ids];
  }, [visible]);
  const { subjects } = useSubjectResolver(personIds);
  const agents = useAppSelector((state) => state.taskAgents.list.agents);
  const showsAgents = visible.some(
    (entry) => entry.action === "agent_assigned" || entry.action === "agent_unassigned",
  );
  useEffect(() => {
    if (showsAgents) dispatch(fetchTaskAgents());
  }, [dispatch, showsAgents]);

  const lookups = useMemo<Lookups>(
    () => ({
      fields: new Map((project?.fieldDefinitions ?? []).map((f) => [f.id, f])),
      tasks,
      sprints,
      people: Object.fromEntries(subjects.map((s) => [s.id, s])),
      agents: Object.fromEntries(agents.map((agent) => [agent.id, agent.name])),
    }),
    [project, tasks, sprints, subjects, agents],
  );

  return (
    <div className="space-y-4">
      <div className="space-y-3 pl-2" data-testid="task-activity-list">
        {visible.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">
            {filter === "all" ? "No recent activity" : "No changes of this kind"}
          </div>
        ) : (
          visible.map((entry) => <ActivityItem key={entry.id} entry={entry} lookups={lookups} />)
        )}
        {hiddenCount > 0 && !isExpanded && (
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Show {hiddenCount} earlier {hiddenCount === 1 ? "entry" : "entries"}
          </button>
        )}
        {isExpanded && maxInitialItems != null && entries.length > maxInitialItems && (
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Show less
          </button>
        )}
      </div>
    </div>
  );
}

function ActivityItem({ entry, lookups }: { entry: ActivityEntry; lookups: Lookups }) {
  const actor = lookups.people[entry.actorId];
  const actorName = actor?.name || "Unknown user";
  const when = new Date(entry.timestamp);
  const [showSteps, setShowSteps] = useState(false);

  return (
    <div className="flex gap-2.5 text-sm" data-testid="task-activity-entry">
      <div className="mt-0.5 shrink-0">
        {actor ? (
          <SubjectAvatar subject={actor} size="xs" />
        ) : (
          <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center">
            <span className="text-[8px] text-muted-foreground font-medium">?</span>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          {entry.agentId ? (
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <Robot size={12} className="text-muted-foreground" />
              {entry.agentName || "An agent"}
              <span className="font-normal text-muted-foreground">for {actorName}</span>
            </span>
          ) : (
            <span className="font-medium text-foreground">{actorName}</span>
          )}
          <span className="text-subtle-foreground shrink-0">{activityIcon(entry.action)}</span>
          <span className="text-foreground">{activityContent(entry, lookups)}</span>
          {entry.count > 1 && (
            <button
              type="button"
              onClick={() => setShowSteps((open) => !open)}
              aria-expanded={showSteps}
              className="text-subtle-foreground underline-offset-2 hover:text-foreground hover:underline"
              data-testid="task-activity-steps-toggle"
            >
              ({entry.count} changes)
            </button>
          )}
          <ActivityTime timestamp={entry.timestamp} when={when} />
        </div>
        {showSteps && entry.steps.length > 0 && (
          <ol
            className="mt-1.5 space-y-1 border-l border-border/60 pl-3"
            data-testid="task-activity-steps"
          >
            {entry.steps.map((step) => (
              <li key={step.id} className="flex items-center gap-1.5 flex-wrap text-xs">
                <span className="text-foreground">{activityContent(step, lookups)}</span>
                <ActivityTime timestamp={step.timestamp} when={new Date(step.timestamp)} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function ActivityTime({ timestamp, when }: { timestamp: string; when: Date }) {
  return (
    <time
      dateTime={timestamp}
      title={formatDateTimeFull(timestamp)}
      className="text-muted-foreground text-[10px] shrink-0"
    >
      {formatDistanceToNow(when, { addSuffix: true })}
    </time>
  );
}

function activityIcon(action: ActivityAction) {
  switch (action) {
    case "created":
      return <PlusCircle size={12} />;
    case "status_changed":
      return <CheckCircle size={12} />;
    case "priority_changed":
      return <ShieldWarning size={12} />;
    case "assigned":
      return <Users size={12} />;
    case "title_changed":
    case "description_edited":
      return <TextAa size={12} />;
    case "start_date_changed":
    case "due_date_changed":
    case "recurrence_changed":
    case "estimate_changed":
      return <CalendarBlank size={12} />;
    case "sprint_changed":
      return <ArrowsLeftRight size={12} />;
    case "parent_changed":
    case "blocked_by_added":
    case "blocked_by_removed":
    case "blocking_added":
    case "blocking_removed":
      return <LinkSimple size={12} />;
    case "tags_changed":
      return <TagIcon size={12} />;
    case "agent_assigned":
    case "agent_unassigned":
      return <Robot size={12} />;
    case "time_logged":
    case "time_updated":
    case "time_removed":
      return <Clock size={12} />;
    default:
      return <PencilSimple size={12} />;
  }
}

function Strong({ children }: { children: ReactNode }) {
  return <span className="font-medium">{children}</span>;
}

function Empty() {
  return <span className="italic text-muted-foreground">none</span>;
}

function OptionPill({
  field,
  optionId,
}: {
  field: FieldDefinition | undefined;
  optionId: string | undefined;
}) {
  if (!optionId) return <Empty />;
  const options: FieldOption[] = field?.config.options ?? [];
  const option = options.find((o) => o.id === optionId);
  const label = option?.label ?? optionId.replace(/^(status|priority)_/, "").replace(/_/g, " ");
  const paint = optionPaint(options, optionId, field?.id === SYSTEM_FIELD_IDS.STATUS);
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-px text-[11px] font-medium"
      style={{ backgroundColor: paint.translucent, color: paint.solid }}
    >
      {label}
    </span>
  );
}

function FromTo({ from, to }: { from: ReactNode; to: ReactNode }) {
  return (
    <>
      {from} <span className="text-muted-foreground">to</span> {to}
    </>
  );
}

function dateText(value: string | undefined): ReactNode {
  return value ? <Strong>{formatDateFull(value)}</Strong> : <Empty />;
}

function taskLabel(id: string | undefined, lookups: Lookups): ReactNode {
  if (!id) return <Empty />;
  const task = lookups.tasks[id];
  return task ? <Strong>{`#${task.number} ${task.title}`}</Strong> : <Strong>another task</Strong>;
}

function names(ids: string[], lookups: Lookups): string {
  return ids.map((id) => lookups.people[id]?.name ?? "someone").join(", ");
}

function customFieldValue(field: FieldDefinition | undefined, raw: string | undefined): ReactNode {
  if (raw === undefined || raw === "") return <Empty />;
  if (field?.type === "single_select") return <OptionPill field={field} optionId={raw} />;
  if (field?.type === "multi_select") {
    let ids: string[] = [];
    try {
      const parsed: unknown = JSON.parse(raw);
      ids = Array.isArray(parsed) ? parsed.map(String) : [raw];
    } catch {
      ids = [raw];
    }
    const labels = ids.map((id) => field.config.options?.find((o) => o.id === id)?.label ?? id);
    return <Strong>{labels.join(", ") || "none"}</Strong>;
  }
  if (field?.type === "date") return dateText(raw);
  return <Strong>{raw}</Strong>;
}

function activityContent(entry: TaskActivity, lookups: Lookups): ReactNode {
  const { previousValue: from, newValue: to } = entry;
  switch (entry.action) {
    case "created":
      return "created this task";
    case "title_changed":
      return (
        <span>
          renamed the task from <Strong>{from || "untitled"}</Strong> to{" "}
          <Strong>{to || "untitled"}</Strong>
        </span>
      );
    case "description_edited":
      return "edited the description";
    case "status_changed":
    case "priority_changed": {
      const field = lookups.fields.get(
        entry.action === "status_changed" ? SYSTEM_FIELD_IDS.STATUS : SYSTEM_FIELD_IDS.PRIORITY,
      );
      return (
        <span className="inline-flex items-center gap-1 flex-wrap">
          changed {entry.action === "status_changed" ? "status" : "priority"} from{" "}
          <FromTo
            from={<OptionPill field={field} optionId={from} />}
            to={<OptionPill field={field} optionId={to} />}
          />
        </span>
      );
    }
    case "type_changed":
      return (
        <span>
          changed type from{" "}
          <FromTo
            from={from ? <Strong>{getTaskTypeConfig(from).label}</Strong> : <Empty />}
            to={to ? <Strong>{getTaskTypeConfig(to).label}</Strong> : <Empty />}
          />
        </span>
      );
    case "assigned": {
      const { added, removed } = listChange(from, to);
      if (!added.length && !removed.length) return "updated assignees";
      return (
        <span>
          {added.length > 0 && (
            <>
              assigned <Strong>{names(added, lookups)}</Strong>
            </>
          )}
          {added.length > 0 && removed.length > 0 && " and "}
          {removed.length > 0 && (
            <>
              unassigned <Strong>{names(removed, lookups)}</Strong>
            </>
          )}
        </span>
      );
    }
    case "start_date_changed":
    case "due_date_changed":
      return (
        <span>
          changed the {entry.action === "start_date_changed" ? "start" : "due"} date from{" "}
          <FromTo from={dateText(from)} to={dateText(to)} />
        </span>
      );
    case "sprint_changed": {
      const sprint = (id: string | undefined) =>
        id ? <Strong>{lookups.sprints[id]?.name ?? "a sprint"}</Strong> : <Strong>backlog</Strong>;
      return (
        <span>
          moved from <FromTo from={sprint(from)} to={sprint(to)} />
        </span>
      );
    }
    case "estimate_changed": {
      const minutes = (v: string | undefined) =>
        v ? <Strong>{formatMinutes(Number(v))}</Strong> : <Empty />;
      return (
        <span>
          changed the estimate from <FromTo from={minutes(from)} to={minutes(to)} />
        </span>
      );
    }
    case "parent_changed":
      return (
        <span>
          changed the parent from{" "}
          <FromTo from={taskLabel(from, lookups)} to={taskLabel(to, lookups)} />
        </span>
      );
    case "recurrence_changed":
      if (!to) return "stopped repeating";
      return from ? "changed how it repeats" : "set it to repeat";
    case "milestone_changed":
      return to === "true" ? "marked it as a milestone" : "unmarked it as a milestone";
    case "tags_changed": {
      const added = parseNameList(to);
      const removed = parseNameList(from);
      return (
        <span>
          {added.length > 0 && (
            <>
              added tags <Strong>{added.join(", ")}</Strong>
            </>
          )}
          {added.length > 0 && removed.length > 0 && " and "}
          {removed.length > 0 && (
            <>
              removed tags <Strong>{removed.join(", ")}</Strong>
            </>
          )}
        </span>
      );
    }
    case "field_updated": {
      const field = entry.fieldId ? lookups.fields.get(entry.fieldId) : undefined;
      return (
        <span className="inline-flex items-center gap-1 flex-wrap">
          changed <Strong>{field?.name ?? "a field"}</Strong> from{" "}
          <FromTo from={customFieldValue(field, from)} to={customFieldValue(field, to)} />
        </span>
      );
    }
    case "blocked_by_added":
      return <span>marked it blocked by {taskLabel(to, lookups)}</span>;
    case "blocked_by_removed":
      return <span>removed blocker {taskLabel(from, lookups)}</span>;
    case "blocking_added":
      return <span>made it block {taskLabel(to, lookups)}</span>;
    case "blocking_removed":
      return <span>stopped it blocking {taskLabel(from, lookups)}</span>;
    case "time_logged":
      return (
        <span>
          logged <Strong>{formatMinutes(Number(to))}</Strong>
        </span>
      );
    case "time_updated":
      return (
        <span>
          changed a time entry from{" "}
          <FromTo
            from={<Strong>{formatMinutes(Number(from))}</Strong>}
            to={<Strong>{formatMinutes(Number(to))}</Strong>}
          />
        </span>
      );
    case "time_removed":
      return (
        <span>
          removed a time entry of <Strong>{formatMinutes(Number(from))}</Strong>
        </span>
      );
    case "agent_assigned":
      return (
        <span>
          gave the task to <Strong>{(to && lookups.agents[to]) || "an agent"}</Strong>
        </span>
      );
    case "agent_unassigned":
      return (
        <span>
          took the task back from <Strong>{(from && lookups.agents[from]) || "an agent"}</Strong>
        </span>
      );
    default:
      return "updated the task";
  }
}
