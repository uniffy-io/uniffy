import { Lock, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { MentionChipCompact } from "@/components/mention";
import { Button } from "@/components/ui/button";
import { STATUS_HEX_COLORS } from "@/config/theme/statusColors";
import { cn } from "@/shared/utils/cn";
import { formatDateShort } from "@/shared/utils/dateFormatting";
import { formatMinutes } from "@/shared/utils/durationFormatting";
import { getEffectiveTimeZone } from "@/shared/utils/timezone";
import type { Worklog } from "@/features/projects/types/time";
import { endOf, wallTimeOf } from "@/features/projects/utils/timeClock";
import {
  dayStatus,
  offLabel,
  taskUrn,
  weekdayShort,
  type DayStatus,
} from "@/features/projects/utils/timeWeek";

const STATUS_COLOR: Record<DayStatus, string | undefined> = {
  none: undefined,
  logged: undefined,
  under: STATUS_HEX_COLORS.warning,
  met: STATUS_HEX_COLORS.success,
  over: STATUS_HEX_COLORS.success,
};

interface TimeListProps {
  days: readonly string[];
  today: string;
  worklogs: readonly Worklog[];
  totals: Record<string, number>;
  requirements: Record<string, { required: number; off: boolean }>;
  labels: Record<string, string>;
  lockHintFor: (day: string) => string | undefined;
  onAdd: (day: string) => void;
  onEdit: (entry: Worklog) => void;
  onDelete: (entry: Worklog) => void;
}

/** The week day by day, every entry on its own line with its clock times when it has them. */
export function TimeList({
  days,
  today,
  worklogs,
  totals,
  requirements,
  labels,
  lockHintFor,
  onAdd,
  onEdit,
  onDelete,
}: TimeListProps) {
  const navigate = useNavigate();
  const zone = getEffectiveTimeZone();
  const byDay = new Map(days.map((day) => [day, [] as Worklog[]]));
  for (const entry of worklogs) byDay.get(entry.workDate)?.push(entry);
  for (const entries of byDay.values()) {
    entries.sort((a, b) => {
      const at = (entry: Worklog) => entry.startedAt ?? `~${entry.createdAt}`;
      return at(a).localeCompare(at(b));
    });
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="time-list">
      {days.map((day) => {
        const { required, off } = requirements[day];
        const status = dayStatus(totals[day], required);
        const away = offLabel(required, off);
        const hint = lockHintFor(day);
        const entries = byDay.get(day) ?? [];
        return (
          <section
            key={day}
            className="border-b border-border/60"
            data-testid="list-day"
            data-day={day}
          >
            <header className="flex items-center gap-3 bg-muted/30 px-4 py-2 text-xs">
              <span className={cn("font-medium", day === today && "text-primary")}>
                {weekdayShort(day)}, {formatDateShort(day)}
              </span>
              {away && <span className="text-subtle-foreground">{away}</span>}
              {hint && (
                <span className="flex items-center gap-1 text-subtle-foreground" title={hint}>
                  <Lock size={10} /> locked
                </span>
              )}
              <span
                className="ml-auto tabular-nums"
                style={{ color: STATUS_COLOR[status] }}
                data-testid="list-day-total"
              >
                {formatMinutes(totals[day])}
                {required > 0 && (
                  <span className="text-muted-foreground"> of {formatMinutes(required)}</span>
                )}
              </span>
              {!hint && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => onAdd(day)}
                  aria-label={`Log time on ${day}`}
                >
                  <Plus size={12} />
                </Button>
              )}
            </header>
            {entries.length === 0 ? (
              <p className="px-4 py-2 text-xs text-subtle-foreground">Nothing logged.</p>
            ) : (
              <ul>
                {entries.map((entry) => {
                  const placed = entry.startedAt ? wallTimeOf(entry.startedAt, zone) : null;
                  const clock =
                    placed && placed.day === day
                      ? `${placed.wall} to ${endOf(placed.wall, entry.durationMinutes)}`
                      : null;
                  const title = labels[entry.taskId] || "Task";
                  return (
                    <li
                      key={entry.id}
                      className="group flex items-start gap-3 px-4 py-2 text-sm hover:bg-foreground/5"
                      data-testid="list-entry"
                    >
                      <span className="w-24 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
                        {clock ?? "no time set"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <MentionChipCompact
                          urn={taskUrn(entry.taskId)}
                          label={title}
                          onClick={() =>
                            navigate(`/projects/${entry.projectId}/tasks/${entry.taskId}`)
                          }
                        />
                        {entry.description && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {entry.description}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 pt-0.5 text-xs font-medium tabular-nums">
                        {formatMinutes(entry.durationMinutes)}
                      </span>
                      <div
                        className={cn(
                          "flex shrink-0 items-center gap-1",
                          hint ? "invisible" : "md:opacity-0 md:group-hover:opacity-100",
                        )}
                      >
                        <button
                          type="button"
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="Edit entry"
                          onClick={() => onEdit(entry)}
                        >
                          <PencilSimple size={12} />
                        </button>
                        <button
                          type="button"
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-500"
                          title="Delete entry"
                          onClick={() => onDelete(entry)}
                        >
                          <Trash size={12} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
