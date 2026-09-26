import { SubjectAvatar } from "@/components/subject";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";
import { TaskTypeIcon } from "@/features/projects/components/TaskTypeIcon";
import type { GroupSum, TaskGroup } from "@/features/projects/utils/groupTasks";
import { formatMinutes } from "@/features/projects/utils/timeFormatting";
import { cn } from "@/shared/utils/cn";

const NO_IDS: string[] = [];

/** A group's value as the table, board and roadmap headers draw it. */
export function GroupHeaderLabel({ group, className }: { group: TaskGroup; className?: string }) {
  const personIds =
    group.display === "person" && group.value.kind === "id" ? [group.value.id] : NO_IDS;
  const { subjects } = useSubjectResolver(personIds);
  const subject = subjects[0];
  const isNone = group.value.kind === "none";

  return (
    <span className={cn("flex items-center gap-2 min-w-0", className)}>
      {subject && <SubjectAvatar subject={subject} size="xs" />}
      {group.display === "swatch" && group.color && (
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: group.color }}
        />
      )}
      {group.display === "task_type" && group.value.kind === "id" && (
        <TaskTypeIcon type={group.value.id} className="text-muted-foreground" />
      )}
      {group.display === "epic" && <TaskTypeIcon type="epic" className="text-muted-foreground" />}
      <span
        className={cn(
          "text-sm font-medium truncate",
          // Italic glyphs lean past the box; the padding keeps the last one out of the clip.
          isNone ? "text-muted-foreground italic pr-0.5" : "text-foreground",
        )}
      >
        {subject?.name ?? group.label}
      </span>
    </span>
  );
}

function formatGroupSum(sum: GroupSum): string {
  return sum.minutes ? formatMinutes(sum.total) : sum.total.toLocaleString();
}

/** Count first, then each sum; the whole row stays one line and truncates on narrow screens. */
export function GroupHeaderStats({
  count,
  sums,
  className,
}: {
  /** Left out where the header already shows the count another way. */
  count?: number;
  sums: readonly GroupSum[];
  className?: string;
}) {
  return (
    <span
      className={cn("flex items-center gap-2 min-w-0 text-xs text-muted-foreground", className)}
    >
      {count !== undefined && (
        <span className="shrink-0 tabular-nums" title={`${count} task${count === 1 ? "" : "s"}`}>
          {count}
        </span>
      )}
      {sums.map((sum) => (
        <span key={sum.key} className="truncate" title={`${sum.label}: ${formatGroupSum(sum)}`}>
          <span className="text-subtle-foreground">{sum.label}</span>{" "}
          <span className="tabular-nums">{formatGroupSum(sum)}</span>
        </span>
      ))}
    </span>
  );
}
