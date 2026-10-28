import { useEffect, useRef, useState } from "react";
import { Play, CheckCircle, DotsThree, Trash, CaretDown, CaretRight } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { SubjectAvatar } from "@/components/subject";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";
import { Button } from "@/components/ui/button";
import { ActionMenu, ActionMenuItem } from "@/components/ui/action-menu";
import { PortalMenu } from "@/components/ui/portal-menu";
import { STATUS_HEX_COLORS } from "@/config/theme/statusColors";
import { startSprint, deleteSprint } from "@/features/projects/store/sprintsThunks";
import { selectSprintCapacity } from "@/features/projects/store/timeSlice";
import { fetchSprintCapacity } from "@/features/projects/store/timeThunks";
import { SprintCompletionDialog } from "@/features/projects/components/modals/SprintCompletionDialog";
import { formatMinutes } from "@/features/projects/utils/timeFormatting";
import { BacklogTaskRow } from "@/features/projects/components/backlog/BacklogTaskRow";
import type { Sprint, Task } from "@/features/projects/types";
import type { SprintCapacity } from "@/features/projects/types/time";

interface SprintCardProps {
  sprint: Sprint;
  tasks: Task[];
  projectId: string;
  projectSlug: string;
}

/** A thin bar of `value` against `max`; red once the value passes the capacity. */
function Meter({ value, max, over }: { value: number; max: number; over?: boolean }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <span className="inline-block h-1.5 w-12 overflow-hidden rounded-full bg-muted align-middle">
      <span
        className={cn(
          "block h-full rounded-full transition-all duration-300",
          !over && "bg-primary",
        )}
        style={{ width: `${pct}%`, backgroundColor: over ? STATUS_HEX_COLORS.error : undefined }}
      />
    </span>
  );
}

function CapacityPopover({ capacity }: { capacity: SprintCapacity }) {
  const { subjects } = useSubjectResolver(capacity.rows.map((row) => row.userId));
  const byId = new Map(subjects.map((subject) => [subject.id, subject]));
  return (
    <div className="p-2 text-xs" data-testid="sprint-capacity-popover">
      <div className="px-2 pb-1 text-[10px] uppercase tracking-wide text-subtle-foreground">
        Capacity by member
      </div>
      <ul className="divide-y divide-border/60">
        {capacity.rows.map((row) => {
          const subject = byId.get(row.userId);
          const over = row.estimatedMinutes > row.capacityMinutes;
          return (
            <li
              key={row.userId}
              className="flex items-center gap-2 px-2 py-1.5"
              data-testid="sprint-capacity-row"
              data-over={over ? "true" : undefined}
            >
              {subject && <SubjectAvatar subject={subject} size="xs" />}
              <span className="min-w-0 flex-1 truncate text-foreground">
                {subject?.name ?? "Member"}
              </span>
              <span
                className="tabular-nums"
                style={{ color: over ? STATUS_HEX_COLORS.error : undefined }}
                title="Estimated against capacity"
              >
                {formatMinutes(row.estimatedMinutes)} / {formatMinutes(row.capacityMinutes)}
              </span>
              <span className="w-14 text-right tabular-nums text-muted-foreground" title="Logged">
                {formatMinutes(row.loggedMinutes)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SprintCard({ sprint, tasks, projectId, projectSlug }: SprintCardProps) {
  const dispatch = useAppDispatch();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const capacityTriggerRef = useRef<HTMLButtonElement>(null);
  const [isCapacityOpen, setIsCapacityOpen] = useState(false);
  const [isCompletionDialogOpen, setIsCompletionDialogOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const capacity = useAppSelector(selectSprintCapacity(sprint.id));

  const completedCount = tasks.filter((t) => t.completedAt).length;
  const totalCount = tasks.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const sprintEstimated = tasks.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0);
  const sprintSpent = tasks.reduce((sum, t) => sum + (t.timeSpentMinutes ?? 0), 0);
  // Estimates, assignments and logged time all move the capacity picture; the dates do too.
  const capacityInputs = tasks
    .map(
      (t) =>
        `${t.id}:${t.estimatedMinutes ?? 0}:${t.timeSpentMinutes ?? 0}:${t.assigneeIds.join(",")}`,
    )
    .join("|");

  useEffect(() => {
    void dispatch(fetchSprintCapacity({ sprintId: sprint.id }));
  }, [dispatch, sprint.id, sprint.startDate, sprint.endDate, capacityInputs]);

  const hasCapacity = (capacity?.capacityMinutes ?? 0) > 0;
  const overCapacity = hasCapacity && capacity!.estimatedMinutes > capacity!.capacityMinutes;

  const dateRange =
    sprint.startDate && sprint.endDate
      ? `${sprint.startDate} – ${sprint.endDate}`
      : sprint.startDate
        ? `From ${sprint.startDate}`
        : sprint.endDate
          ? `Until ${sprint.endDate}`
          : null;

  const handleStartSprint = async () => {
    setIsStarting(true);
    setError(null);
    try {
      await dispatch(startSprint({ id: sprint.id })).unwrap();
    } catch (err: unknown) {
      const raw =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "message" in err
            ? String((err as { message: unknown }).message)
            : String(err);
      // Extract the human-readable part after the field prefix
      const match = raw.match(/Validation error on '[^']+': (.+)/);
      setError(match ? match[1] : raw);
    } finally {
      setIsStarting(false);
    }
  };

  const handleDeleteSprint = async () => {
    await dispatch(deleteSprint({ sprintId: sprint.id, projectId })).unwrap();
  };

  const statusColor =
    sprint.status === "active"
      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
      : "bg-muted text-muted-foreground";

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {isCollapsed ? <CaretRight size={14} /> : <CaretDown size={14} />}
        </button>

        <span className="font-medium text-foreground flex-1 min-w-0 truncate">{sprint.name}</span>

        {dateRange && <span className="text-xs text-muted-foreground shrink-0">{dateRange}</span>}

        <span className="text-xs text-muted-foreground shrink-0">
          {completedCount}/{totalCount} ({progressPct}%)
        </span>

        {hasCapacity && capacity ? (
          <button
            type="button"
            ref={capacityTriggerRef}
            onClick={() => setIsCapacityOpen(!isCapacityOpen)}
            className="focus-ring flex shrink-0 items-center gap-3 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Capacity by member"
            aria-haspopup="dialog"
            aria-expanded={isCapacityOpen}
            data-testid="sprint-capacity"
            data-over={overCapacity ? "true" : undefined}
          >
            <span className="flex items-center gap-1.5 tabular-nums">
              <Meter
                value={capacity.estimatedMinutes}
                max={capacity.capacityMinutes}
                over={overCapacity}
              />
              <span style={{ color: overCapacity ? STATUS_HEX_COLORS.error : undefined }}>
                {formatMinutes(capacity.estimatedMinutes)} est.
              </span>
            </span>
            <span className="flex items-center gap-1.5 tabular-nums">
              <Meter value={capacity.loggedMinutes} max={capacity.capacityMinutes} />
              <span>
                {formatMinutes(capacity.loggedMinutes)} / {formatMinutes(capacity.capacityMinutes)}
              </span>
            </span>
          </button>
        ) : (
          sprintEstimated > 0 && (
            <span className="text-xs text-muted-foreground shrink-0">
              {formatMinutes(sprintSpent)} / {formatMinutes(sprintEstimated)}
            </span>
          )
        )}

        <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium shrink-0", statusColor)}>
          {sprint.status}
        </span>

        {/* Progress bar */}
        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden shrink-0">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {sprint.status === "planned" && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs shrink-0"
            onClick={handleStartSprint}
            disabled={isStarting}
          >
            <Play size={12} className="mr-1" />
            Start
          </Button>
        )}

        {sprint.status === "active" && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs shrink-0"
            onClick={() => setIsCompletionDialogOpen(true)}
          >
            <CheckCircle size={12} className="mr-1" />
            Complete
          </Button>
        )}

        <div className="relative shrink-0">
          <button
            type="button"
            className="focus-ring grid h-11 w-11 lg:h-6 lg:w-6 place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            ref={menuTriggerRef}
            aria-label="Sprint actions"
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            <DotsThree size={16} weight="bold" />
          </button>
          {isMenuOpen && (
            <ActionMenu
              open
              triggerRef={menuTriggerRef}
              onClose={() => setIsMenuOpen(false)}
              label="Sprint actions"
            >
              <ActionMenuItem
                type="button"
                destructive
                onClick={() => {
                  setIsMenuOpen(false);
                  handleDeleteSprint();
                }}
              >
                <Trash size={16} />
                Delete Sprint
              </ActionMenuItem>
            </ActionMenu>
          )}
        </div>
      </div>

      {capacity && (
        <PortalMenu
          open={isCapacityOpen}
          onClose={() => setIsCapacityOpen(false)}
          triggerRef={capacityTriggerRef}
          align="right"
          className="w-80"
        >
          <CapacityPopover capacity={capacity} />
        </PortalMenu>
      )}

      {/* Error message */}
      {error && (
        <div className="px-4 py-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-b border-border">
          {error}
        </div>
      )}

      {/* Task list */}
      {!isCollapsed && (
        <div className="divide-y divide-border">
          {tasks.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No tasks in this sprint.
            </div>
          ) : (
            tasks.map((task) => (
              <BacklogTaskRow
                key={task.id}
                task={task}
                projectId={projectId}
                projectSlug={projectSlug}
                currentSprintId={sprint.id}
              />
            ))
          )}
        </div>
      )}

      {isCompletionDialogOpen && (
        <SprintCompletionDialog
          sprint={sprint}
          projectId={projectId}
          projectSlug={projectSlug}
          incompleteTasks={tasks.filter((t) => !t.completedAt)}
          onClose={() => setIsCompletionDialogOpen(false)}
        />
      )}
    </div>
  );
}
