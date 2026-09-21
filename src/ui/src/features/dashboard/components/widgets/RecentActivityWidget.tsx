import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ClockCounterClockwise } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { UrnType } from "@/shared/utils/urnTypes";
import { getContentTypeConfig } from "@/config/theme/contentTypes";
import type { TaskStatusSemantic } from "@/features/projects/types/fields";
import { statusOptionsOf, statusSemanticOf } from "@/features/projects/utils/statusSemantics";
import {
  WidgetCard,
  EmptyWidget,
  WidgetSkeleton,
} from "@/features/dashboard/components/widgets/WidgetCard";
import {
  formatRelativeTime,
  formatFileSize,
  formatSmartDateTime,
} from "@/shared/utils/dateFormatting";
import type { Task } from "@/features/projects/types/project";
import { taskPath } from "@/features/projects/utils/taskPath";
import type { CalendarEvent } from "@/features/calendar/types";

interface ActivityItem {
  id: string;
  title: string;
  type: UrnType;
  updatedAt: string;
  href: string;
  meta: string;
  extra?: string;
  statusDot?: string;
}

type FilterTab = "all" | "notes" | "files" | "tasks" | "events" | "projects";

const FILTER_TABS: { key: FilterTab; label: string; type: UrnType | null }[] = [
  { key: "all", label: "All", type: null },
  { key: "notes", label: "Notes", type: UrnType.NOTE },
  { key: "files", label: "Files", type: UrnType.FILE },
  { key: "tasks", label: "Tasks", type: UrnType.TASK },
  { key: "events", label: "Events", type: UrnType.CALENDAR_EVENT },
  { key: "projects", label: "Projects", type: UrnType.PROJECT },
];

function timestampToString(ts: { seconds: number; nanos: number } | undefined): string {
  if (!ts) return new Date(0).toISOString();
  return new Date(ts.seconds * 1000).toISOString();
}

function taskStatusDot(semantic: TaskStatusSemantic | null): string {
  switch (semantic) {
    case "completed":
      return "bg-green-500";
    case "in_progress":
    case "review":
      return "bg-blue-500";
    default:
      return "bg-muted-foreground/40";
  }
}

function priorityText(priority: string): string {
  switch (priority) {
    case "priority_urgent":
      return "Urgent";
    case "priority_high":
      return "High";
    case "priority_medium":
      return "Medium";
    case "priority_low":
      return "Low";
    default:
      return "";
  }
}

function mimeToLabel(mime: string): string {
  if (mime.startsWith("image/")) return "Image";
  if (mime.startsWith("video/")) return "Video";
  if (mime.startsWith("audio/")) return "Audio";
  if (mime === "application/pdf") return "PDF";
  if (mime.includes("spreadsheet") || mime === "text/csv") return "Spreadsheet";
  if (mime.includes("document") || mime.includes("wordprocessing")) return "Document";
  if (mime.includes("presentation")) return "Presentation";
  if (mime === "application/json") return "JSON";
  if (mime.startsWith("text/")) return "Text";
  return "File";
}

function ActivityRow({ item, showType }: { item: ActivityItem; showType: boolean }) {
  const config = getContentTypeConfig(item.type);
  const Icon = config.icon;

  return (
    <Link
      to={item.href}
      className="group grid grid-cols-[auto_1fr_auto] md:grid-cols-[auto_1fr_minmax(100px,180px)_minmax(80px,200px)_80px] items-center gap-x-3 px-4 py-3 border-b border-border/50 last:border-b-0 hover:bg-muted/40 transition-colors"
    >
      <div
        className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
          config.theme.badgeBg,
        )}
      >
        <Icon size={16} weight="duotone" className={config.theme.accentText} />
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {item.statusDot && (
            <span className={cn("w-2 h-2 rounded-full shrink-0", item.statusDot)} />
          )}
          <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
            {item.title || "Untitled"}
          </p>
          {showType && (
            <span
              className={cn(
                "hidden md:inline text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0",
                config.theme.badgeBg,
                config.theme.accentText,
              )}
            >
              {config.label}
            </span>
          )}
        </div>
        <p className="md:hidden text-xs text-muted-foreground mt-0.5 truncate">
          {config.label} {item.meta && ` \u00b7 ${item.meta}`}
        </p>
      </div>

      <p className="hidden md:block text-xs text-muted-foreground truncate">{item.meta}</p>

      <p className="hidden md:block text-xs text-muted-foreground truncate">{item.extra ?? ""}</p>

      <span className="text-xs text-muted-foreground tabular-nums text-right shrink-0">
        {formatRelativeTime(item.updatedAt)}
      </span>
    </Link>
  );
}

export function RecentActivityWidget() {
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");

  const notes = useAppSelector((state) => state.notes?.notes ?? {});
  const notesLoading = useAppSelector((state) => state.notes?.loading ?? false);

  const files = useAppSelector((state) => state.files?.files ?? {});
  const filesLoading = useAppSelector((state) => state.files?.loading ?? false);

  const events = useAppSelector((state) => state.calendar?.events ?? {});
  const eventsLoading = useAppSelector((state) => state.calendar?.loading?.events ?? false);

  const tasks = useAppSelector((state) => state.projects?.tasks ?? {});
  const tasksLoading = useAppSelector((state) => state.projects?.loading?.tasks ?? false);

  const projects = useAppSelector((state) => state.projects?.projects ?? {});
  const projectsLoading = useAppSelector((state) => state.projects?.loading?.projects ?? false);

  const tagsById = useAppSelector((state) => state.tags?.byId ?? {});

  const isLoading =
    notesLoading || filesLoading || eventsLoading || tasksLoading || projectsLoading;
  const showType = activeFilter === "all";

  const allItems = useMemo(() => {
    const items: ActivityItem[] = [];

    Object.values(notes).forEach((note) => {
      if (!note.isDeleted) {
        const wordCount = (note.content || "").split(/\s+/).filter(Boolean).length;
        items.push({
          id: note.id,
          title: note.title,
          type: UrnType.NOTE,
          updatedAt: timestampToString(note.updatedAt),
          href: `/notes/${note.id}`,
          meta: wordCount > 0 ? `${wordCount} words` : "Empty",
          extra: undefined,
        });
      }
    });

    Object.values(files).forEach((file) => {
      if (!file.isDeleted) {
        items.push({
          id: file.id,
          title: file.filename,
          type: UrnType.FILE,
          updatedAt: timestampToString(file.updatedAt),
          href: `/files?file=${file.id}`,
          meta: `${mimeToLabel(file.mimeType)} \u00b7 ${formatFileSize(file.sizeBytes)}`,
          extra: file.tagIds?.length
            ? file.tagIds
                .slice(0, 3)
                .map((id) => tagsById[id]?.slug)
                .filter(Boolean)
                .join(", ") || undefined
            : undefined,
        });
      }
    });

    Object.values(events).forEach((event: CalendarEvent) => {
      items.push({
        id: event.id,
        title: event.title,
        type: UrnType.CALENDAR_EVENT,
        updatedAt: event.updatedAt,
        href: `/calendar?event=${event.id}`,
        meta: event.isAllDay ? "All day" : formatSmartDateTime(event.startTime),
        extra: event.location || undefined,
      });
    });

    Object.values(tasks).forEach((task: Task) => {
      if (!task.deletedAt) {
        const project = task.projectId ? projects[task.projectId] : undefined;
        const status = statusOptionsOf(project?.fieldDefinitions).find((o) => o.id === task.status);
        const parts = [status?.label, priorityText(task.priority)].filter(Boolean);
        items.push({
          id: task.id,
          title: task.title,
          type: UrnType.TASK,
          updatedAt: task.updatedAt,
          href: taskPath(task.projectId, task.id),
          meta: parts.join(" \u00b7 "),
          extra: [project?.name, task.dueDate ? `Due ${formatSmartDateTime(task.dueDate)}` : null]
            .filter(Boolean)
            .join(" \u00b7 "),
          statusDot: taskStatusDot(status ? statusSemanticOf(status) : null),
        });
      }
    });

    Object.values(projects).forEach((project) => {
      if (!project.deletedAt) {
        const allProjectTasks = Object.values(tasks).filter(
          (t: Task) => t.projectId === project.id && !t.deletedAt,
        );
        const doneCount = allProjectTasks.filter((t: Task) => t.completedAt).length;
        const totalCount = allProjectTasks.length;
        items.push({
          id: project.id,
          title: project.name,
          type: UrnType.PROJECT,
          updatedAt: project.updatedAt,
          href: `/projects/${project.id}`,
          meta: totalCount > 0 ? `${doneCount}/${totalCount} tasks completed` : "No tasks yet",
          extra: project.description ? project.description.slice(0, 80) : undefined,
        });
      }
    });

    return items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [notes, files, events, tasks, projects, tagsById]);

  const tabCounts = useMemo(() => {
    const counts: Record<FilterTab, number> = {
      all: 0,
      notes: 0,
      files: 0,
      tasks: 0,
      events: 0,
      projects: 0,
    };
    for (const item of allItems) {
      counts.all++;
      if (item.type === UrnType.NOTE) counts.notes++;
      else if (item.type === UrnType.FILE) counts.files++;
      else if (item.type === UrnType.TASK) counts.tasks++;
      else if (item.type === UrnType.CALENDAR_EVENT) counts.events++;
      else if (item.type === UrnType.PROJECT) counts.projects++;
    }
    return counts;
  }, [allItems]);

  const filteredItems = useMemo(() => {
    const tab = FILTER_TABS.find((t) => t.key === activeFilter);
    const type = tab?.type ?? null;
    const filtered = type ? allItems.filter((item) => item.type === type) : allItems;
    return filtered.slice(0, 20);
  }, [allItems, activeFilter]);

  const isEmpty = filteredItems.length === 0 && !isLoading;

  return (
    <WidgetCard
      title="Recent Activity"
      icon={ClockCounterClockwise}
      colSpan={4}
      priority={2}
      compact
    >
      <div className="flex items-center gap-1 mb-3 flex-wrap">
        {FILTER_TABS.map((tab) => {
          const count = tabCounts[tab.key];
          const tabConfig = tab.type ? getContentTypeConfig(tab.type) : null;
          const TabIcon = tabConfig?.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              className={cn(
                "px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5",
                activeFilter === tab.key
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              {TabIcon && <TabIcon size={13} weight="duotone" />}
              {tab.label}
              {count > 0 && (
                <span
                  className={cn(
                    "text-[10px] min-w-5 text-center px-1 py-0.5 rounded-full tabular-nums leading-none",
                    activeFilter === tab.key
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="hidden md:grid grid-cols-[auto_1fr_minmax(100px,180px)_minmax(80px,200px)_80px] items-center gap-x-3 px-4 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider border-b border-border">
        <span className="w-8" />
        <span>Name</span>
        <span>Details</span>
        <span>Context</span>
        <span className="text-right">Updated</span>
      </div>

      {isLoading && Object.keys(notes).length === 0 ? (
        <WidgetSkeleton rows={6} />
      ) : isEmpty ? (
        <EmptyWidget
          icon={ClockCounterClockwise}
          title="No recent activity"
          description="Your activity will appear here as you work across notes, files, tasks, and more"
        />
      ) : (
        <div>
          {filteredItems.map((item) => (
            <ActivityRow key={`${item.type}-${item.id}`} item={item} showType={showType} />
          ))}
        </div>
      )}
    </WidgetCard>
  );
}
