import { useEffect, useMemo, useState } from "react";
import { Pencil, CircleNotch, Check } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import type { MentionLiveState } from "@/components/mention/types";

interface StatusStyle {
  bg: string;
  text: string;
  label: string;
}

function getTaskStatusStyle(status: string): StatusStyle {
  const lower = status.toLowerCase();

  if (lower.includes("done") || lower.includes("complete") || lower.includes("closed")) {
    return {
      bg: "bg-green-500/15 dark:bg-green-400/15",
      text: "text-green-700 dark:text-green-300",
      label: formatStatusLabel(status),
    };
  }

  if (
    lower.includes("progress") ||
    lower.includes("active") ||
    lower.includes("review") ||
    lower.includes("doing")
  ) {
    return {
      bg: "bg-amber-500/15 dark:bg-amber-400/15",
      text: "text-amber-700 dark:text-amber-300",
      label: formatStatusLabel(status),
    };
  }

  return {
    bg: "bg-blue-500/15 dark:bg-blue-400/15",
    text: "text-blue-700 dark:text-blue-300",
    label: formatStatusLabel(status),
  };
}

function formatStatusLabel(status: string): string {
  return status
    .replace(/^status_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/, (c) => c.toUpperCase());
}

function isCompletedStatus(status: string): boolean {
  const lower = status.toLowerCase();
  return lower.includes("done") || lower.includes("complete") || lower.includes("closed");
}

export function TaskStatusIndicator({
  status,
  label,
  color,
}: {
  status: string;
  label?: string;
  color?: string;
}) {
  const fallbackStyle = getTaskStatusStyle(status);
  const isDone = isCompletedStatus(status);
  const displayLabel = label || fallbackStyle.label;

  if (color) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-0.5",
          "rounded-full px-1.5 py-px",
          "text-[10px] font-semibold leading-tight tracking-wide uppercase",
          "transition-all duration-300 ease-out",
        )}
        style={{
          backgroundColor: `${color}20`,
          color,
        }}
        aria-label={`Status: ${displayLabel}`}
      >
        {isDone && <Check size={9} weight="bold" className="shrink-0" />}
        <span>{displayLabel}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5",
        "rounded-full px-1.5 py-px",
        "text-[10px] font-semibold leading-tight tracking-wide uppercase",
        "transition-all duration-300 ease-out",
        fallbackStyle.bg,
        fallbackStyle.text,
      )}
      aria-label={`Status: ${displayLabel}`}
    >
      {isDone && <Check size={9} weight="bold" className="shrink-0" />}
      <span>{displayLabel}</span>
    </span>
  );
}

export function TaskPriorityIndicator({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-[10px] text-muted-foreground font-medium">{label}</span>
    </span>
  );
}

export function TaskDueDateIndicator({ dueDate }: { dueDate: string }) {
  const label = useMemo(() => {
    const due = new Date(dueDate);
    const now = new Date();
    const diffMs = due.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return { text: `${Math.abs(diffDays)}d overdue`, urgent: true };
    if (diffDays === 0) return { text: "Due today", urgent: true };
    if (diffDays === 1) return { text: "Due tomorrow", urgent: false };
    if (diffDays <= 7) return { text: `Due in ${diffDays}d`, urgent: false };
    return null;
  }, [dueDate]);

  if (!label) return null;

  return (
    <span
      className={cn(
        "text-[10px] font-medium leading-tight",
        label.urgent ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
      )}
    >
      {label.text}
    </span>
  );
}

export function CalendarTemporalIndicator({
  startTime,
  endTime,
}: {
  startTime: string;
  endTime?: string;
  isAllDay?: boolean;
}) {
  const [, setTick] = useState(0);

  // Re-render periodically so relative labels stay fresh.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const temporal = useMemo(() => {
    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : null;
    const now = new Date();

    if (now >= start && end && now <= end) {
      return { text: "Now", isLive: true };
    }

    const diffMs = start.getTime() - now.getTime();
    const diffMins = Math.round(diffMs / 60_000);

    if (diffMins > 0) {
      if (diffMins <= 5) return { text: "Starting", isLive: true };
      if (diffMins < 60) return { text: `In ${diffMins}m`, isLive: false };
      const hours = Math.round(diffMins / 60);
      if (hours < 24) return { text: `In ${hours}h`, isLive: false };
      const days = Math.round(hours / 24);
      if (days === 1) return { text: "Tomorrow", isLive: false };
      return { text: `In ${days}d`, isLive: false };
    }

    const absMins = Math.abs(diffMins);
    if (absMins < 60) return { text: `${absMins}m ago`, isLive: false };
    const absHours = Math.round(absMins / 60);
    if (absHours < 24) return { text: `${absHours}h ago`, isLive: false };
    const absDays = Math.round(absHours / 24);
    if (absDays === 1) return { text: "Yesterday", isLive: false };
    return { text: `${absDays}d ago`, isLive: false };
  }, [startTime, endTime]);

  return (
    <span className="inline-flex items-center gap-1">
      {temporal.isLive && (
        <span className="relative flex shrink-0">
          <span className="w-[5px] h-[5px] rounded-full bg-green-500" />
          <span className="absolute inset-0 w-[5px] h-[5px] rounded-full bg-green-500 animate-ping opacity-75" />
        </span>
      )}
      <span
        className={cn(
          "text-[10px] font-medium leading-tight",
          temporal.isLive ? "text-green-600 dark:text-green-400" : "text-muted-foreground",
        )}
      >
        {temporal.text}
      </span>
    </span>
  );
}

export function NoteEditingIndicator({ editorName }: { editorName?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground italic">
      <Pencil size={10} weight="fill" className="text-primary animate-pulse shrink-0" />
      <span className="truncate max-w-[80px]">
        {editorName ? `${editorName} editing` : "Editing"}
      </span>
    </span>
  );
}

export function FileProcessingIndicator({
  status,
  mimeType,
  fileSize,
}: {
  status: string;
  mimeType?: string;
  fileSize?: number;
}) {
  if (status === "processing" || status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
        <CircleNotch size={10} weight="bold" className="animate-spin shrink-0" />
        <span>Processing</span>
      </span>
    );
  }

  if (status === "completed" && (mimeType || fileSize)) {
    const sizeStr = fileSize ? formatBytes(fileSize) : "";
    const typeStr = mimeType ? mimeType.split("/")[1]?.toUpperCase() : "";
    const parts = [typeStr, sizeStr].filter(Boolean);
    if (parts.length === 0) return null;

    return (
      <span className="text-[10px] text-muted-foreground font-medium">{parts.join(" / ")}</span>
    );
  }

  return null;
}

export function ProjectProgressIndicator({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-10 h-[3px] rounded-full bg-muted overflow-hidden">
        <span
          className="h-full rounded-full bg-orange-500 dark:bg-orange-400 transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="text-[10px] text-muted-foreground font-medium tabular-nums">{pct}%</span>
    </span>
  );
}

export function LiveIndicator({
  urnType,
  liveState,
  compact,
}: {
  urnType: string;
  liveState: MentionLiveState;
  compact?: boolean;
}) {
  switch (urnType) {
    case "task":
      return (
        <span className="inline-flex items-center gap-1.5">
          {liveState.taskStatus && (
            <TaskStatusIndicator
              status={liveState.taskStatus}
              label={liveState.taskStatusLabel}
              color={liveState.taskStatusColor}
            />
          )}
          {!compact && liveState.taskDueDate && (
            <TaskDueDateIndicator dueDate={liveState.taskDueDate} />
          )}
        </span>
      );

    case "calendar_event":
      if (!liveState.eventStartTime) return null;
      return (
        <CalendarTemporalIndicator
          startTime={liveState.eventStartTime}
          endTime={liveState.eventEndTime}
          isAllDay={liveState.eventIsAllDay}
        />
      );

    case "note":
      if (!liveState.noteIsBeingEdited) return null;
      return compact ? (
        <Pencil size={10} weight="fill" className="text-primary animate-pulse shrink-0" />
      ) : (
        <NoteEditingIndicator editorName={liveState.noteEditorName} />
      );

    case "file":
      if (!liveState.fileProcessingStatus) return null;
      return (
        <FileProcessingIndicator
          status={liveState.fileProcessingStatus}
          mimeType={liveState.fileMimeType}
          fileSize={liveState.fileSize}
        />
      );

    case "project":
      if (liveState.projectTotalTasks == null || liveState.projectTotalTasks === 0) return null;
      return (
        <ProjectProgressIndicator
          completed={liveState.projectCompletedTasks ?? 0}
          total={liveState.projectTotalTasks}
        />
      );

    default:
      return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
