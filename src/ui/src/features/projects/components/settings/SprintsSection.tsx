/**
 * SprintsSection - Manage project sprints (list, create, edit, delete)
 *
 * This is the configuration and list-management surface for sprints.
 * Tactical planning actions (drag tasks into sprints, start a sprint,
 * complete a sprint) still live in the Backlog view.
 */

import { useState, useMemo, useEffect } from "react";
import {
  Lightning,
  PencilSimple,
  Trash,
  Plus,
  Clock,
  CheckCircle,
  Circle,
  Play,
  Flag,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { formatDateShort } from "@/shared/utils/dateFormatting";
import { selectSprintsForProject } from "@/features/projects/store/sprintsSlice";
import {
  fetchSprints,
  createSprint,
  updateSprint,
  deleteSprint,
  startSprint,
  completeSprint,
} from "@/features/projects/store/sprintsThunks";
import type { Project, Sprint } from "@/features/projects/types";

interface SprintsSectionProps {
  project: Project;
}

export function SprintsSection({ project }: SprintsSectionProps) {
  const dispatch = useAppDispatch();
  const sprints = useAppSelector(selectSprintsForProject(project.id));

  const [showClosed, setShowClosed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Sprint | null>(null);
  const [startTarget, setStartTarget] = useState<Sprint | null>(null);
  const [completeTarget, setCompleteTarget] = useState<Sprint | null>(null);

  // Ensure sprints are loaded
  useEffect(() => {
    dispatch(fetchSprints(project.id));
  }, [dispatch, project.id]);

  // Partition sprints by status for display
  const { activeSprint, plannedSprints, closedSprints } = useMemo(() => {
    const active = sprints.find((s) => s.status === "active") ?? null;
    const planned = sprints.filter((s) => s.status === "planned");
    const closed = sprints.filter((s) => s.status === "closed");
    return { activeSprint: active, plannedSprints: planned, closedSprints: closed };
  }, [sprints]);

  return (
    <div className="space-y-8">
      {/* Section Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2 flex items-center gap-3">
          <Lightning size={24} weight="duotone" className="text-primary shrink-0" />
          Sprints
        </h1>
        <p className="text-muted-foreground">
          Sprints are time-boxed work cycles. Create sprints here and use the Backlog view to plan, start, and complete them.
        </p>
      </div>

      {/* Active Sprint */}
      {activeSprint && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <CheckCircle size={18} weight="fill" className="text-green-500" />
            Active Sprint
          </h2>
          <div className="bg-card rounded-lg border border-border p-4 md:p-6">
            <SprintRow
              sprint={activeSprint}
              isEditing={editingId === activeSprint.id}
              onStartEdit={() => setEditingId(activeSprint.id)}
              onEndEdit={() => setEditingId(null)}
              onDelete={() => setDeleteTarget(activeSprint)}
              onComplete={() => setCompleteTarget(activeSprint)}
              projectId={project.id}
              hasActiveSprint={true}
            />
          </div>
        </section>
      )}

      {/* Planned Sprints */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Circle size={18} weight="duotone" className="text-muted-foreground" />
            Planned Sprints
            {plannedSprints.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                ({plannedSprints.length})
              </span>
            )}
          </h2>
        </div>
        <div className="bg-card rounded-lg border border-border p-4 md:p-6 space-y-2">
          {plannedSprints.length === 0 && !isCreating && (
            <p className="text-sm text-muted-foreground">
              No planned sprints. Create one below.
            </p>
          )}
          {plannedSprints.map((sprint) => (
            <SprintRow
              key={sprint.id}
              sprint={sprint}
              isEditing={editingId === sprint.id}
              onStartEdit={() => setEditingId(sprint.id)}
              onEndEdit={() => setEditingId(null)}
              onDelete={() => setDeleteTarget(sprint)}
              onStart={() => setStartTarget(sprint)}
              projectId={project.id}
              hasActiveSprint={!!activeSprint}
            />
          ))}

          {isCreating ? (
            <CreateSprintInline
              projectId={project.id}
              onCancel={() => setIsCreating(false)}
              onCreated={() => setIsCreating(false)}
            />
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="border-dashed text-muted-foreground"
              onClick={() => setIsCreating(true)}
            >
              <Plus size={14} className="mr-2" />
              New Sprint
            </Button>
          )}
        </div>
      </section>

      {/* Closed Sprints (collapsible) */}
      {closedSprints.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Clock size={18} weight="duotone" className="text-muted-foreground" />
              Closed Sprints
              <span className="text-xs font-normal text-muted-foreground">
                ({closedSprints.length})
              </span>
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Show</span>
              <ToggleSwitch enabled={showClosed} onChange={setShowClosed} size="sm" />
            </div>
          </div>
          {showClosed && (
            <div className="bg-card rounded-lg border border-border p-4 md:p-6 space-y-2">
              {closedSprints.map((sprint) => (
                <SprintRow
                  key={sprint.id}
                  sprint={sprint}
                  isEditing={editingId === sprint.id}
                  onStartEdit={() => setEditingId(sprint.id)}
                  onEndEdit={() => setEditingId(null)}
                  onDelete={() => setDeleteTarget(sprint)}
                  projectId={project.id}
                  hasActiveSprint={!!activeSprint}
                  readOnly
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await dispatch(deleteSprint({ sprintId: deleteTarget.id, projectId: project.id }));
          setDeleteTarget(null);
        }}
        title="Delete Sprint"
        message={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget.name}"? All ${deleteTarget.taskCount} task${deleteTarget.taskCount === 1 ? "" : "s"} in this sprint will be moved back to the backlog.`
            : ""
        }
        confirmLabel="Delete Sprint"
        variant="danger"
      />

      {/* Start Sprint Confirmation */}
      <ConfirmDialog
        isOpen={!!startTarget}
        onClose={() => setStartTarget(null)}
        onConfirm={async () => {
          if (!startTarget) return;
          await dispatch(
            startSprint({
              id: startTarget.id,
              startDate: startTarget.startDate || undefined,
              endDate: startTarget.endDate || undefined,
            })
          );
          setStartTarget(null);
        }}
        title="Start Sprint"
        message={
          startTarget
            ? `Start "${startTarget.name}"? This will make it the active sprint for the project. Only one sprint can be active at a time.`
            : ""
        }
        confirmLabel="Start Sprint"
      />

      {/* Complete Sprint Confirmation */}
      <ConfirmDialog
        isOpen={!!completeTarget}
        onClose={() => setCompleteTarget(null)}
        onConfirm={async () => {
          if (!completeTarget) return;
          await dispatch(completeSprint(completeTarget.id));
          setCompleteTarget(null);
        }}
        title="Complete Sprint"
        message={
          completeTarget
            ? `Mark "${completeTarget.name}" as complete? ${
                completeTarget.taskCount - completeTarget.completedTaskCount > 0
                  ? `${completeTarget.taskCount - completeTarget.completedTaskCount} incomplete task${completeTarget.taskCount - completeTarget.completedTaskCount === 1 ? "" : "s"} will remain in this sprint.`
                  : "All tasks are done."
              }`
            : ""
        }
        confirmLabel="Complete Sprint"
      />
    </div>
  );
}

// ===== Sprint Row =====

interface SprintRowProps {
  sprint: Sprint;
  projectId: string;
  isEditing: boolean;
  hasActiveSprint: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onDelete: () => void;
  onStart?: () => void;
  onComplete?: () => void;
  readOnly?: boolean;
}

function SprintRow({
  sprint,
  isEditing,
  hasActiveSprint,
  onStartEdit,
  onEndEdit,
  onDelete,
  onStart,
  onComplete,
  readOnly,
}: SprintRowProps) {
  const dispatch = useAppDispatch();
  const [name, setName] = useState(sprint.name);
  const [goal, setGoal] = useState(sprint.goal || "");
  const [startDate, setStartDate] = useState(sprint.startDate || "");
  const [endDate, setEndDate] = useState(sprint.endDate || "");
  const [isSaving, setIsSaving] = useState(false);

  // Reset form when entering edit mode
  useEffect(() => {
    if (isEditing) {
      setName(sprint.name);
      setGoal(sprint.goal || "");
      setStartDate(sprint.startDate || "");
      setEndDate(sprint.endDate || "");
    }
  }, [isEditing, sprint]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      await dispatch(
        updateSprint({
          id: sprint.id,
          name: name.trim(),
          goal: goal.trim(),
          startDate: startDate || null,
          endDate: endDate || null,
        })
      ).unwrap();
      onEndEdit();
    } finally {
      setIsSaving(false);
    }
  };

  if (isEditing) {
    return (
      <div className="p-3 rounded-lg border border-primary/30 bg-background space-y-3">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sprint name"
          autoFocus
        />
        <Input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Sprint goal (optional)"
        />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Start date
            </label>
            <DatePicker value={startDate} onChange={setStartDate} />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              End date
            </label>
            <DatePicker value={endDate} onChange={setEndDate} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onEndEdit} disabled={isSaving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!name.trim() || isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    );
  }

  const completionPct =
    sprint.taskCount > 0
      ? Math.round((sprint.completedTaskCount / sprint.taskCount) * 100)
      : 0;

  return (
    <div className="group flex items-center gap-3 p-3 rounded-lg border border-transparent hover:bg-muted/40 transition-colors">
      <StatusBadge status={sprint.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">{sprint.name}</span>
          <span className="text-xs text-muted-foreground">
            {sprint.completedTaskCount}/{sprint.taskCount}
            {sprint.taskCount > 0 && ` (${completionPct}%)`}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
          {sprint.startDate && sprint.endDate ? (
            <span>
              {formatDateShort(sprint.startDate)} - {formatDateShort(sprint.endDate)}
            </span>
          ) : (
            <span className="italic">No dates set</span>
          )}
          {sprint.goal && (
            <>
              <span>&middot;</span>
              <span className="truncate">{sprint.goal}</span>
            </>
          )}
        </div>
      </div>

      {/* Primary state-transition action (always visible) */}
      {sprint.status === "planned" && onStart && (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={onStart}
          disabled={hasActiveSprint}
          title={hasActiveSprint ? "Complete the active sprint first" : "Start this sprint"}
        >
          <Play size={12} weight="fill" className="mr-1" />
          Start
        </Button>
      )}
      {sprint.status === "active" && onComplete && (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 border-green-500/30 text-green-600 dark:text-green-400 hover:bg-green-500/10"
          onClick={onComplete}
        >
          <Flag size={12} weight="fill" className="mr-1" />
          Complete
        </Button>
      )}

      {/* Secondary actions (hover-visible) */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {!readOnly && (
          <button
            type="button"
            onClick={onStartEdit}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded"
            title="Edit"
          >
            <PencilSimple size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          className="p-1 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded"
          title="Delete"
        >
          <Trash size={14} />
        </button>
      </div>
    </div>
  );
}

// ===== Inline Create Form =====

interface CreateSprintInlineProps {
  projectId: string;
  onCancel: () => void;
  onCreated: () => void;
}

function CreateSprintInline({ projectId, onCancel, onCreated }: CreateSprintInlineProps) {
  const dispatch = useAppDispatch();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setIsSubmitting(true);
    try {
      await dispatch(
        createSprint({
          projectId,
          name: name.trim(),
          goal: goal.trim() || undefined,
          startDate: startDate || null,
          endDate: endDate || null,
        })
      ).unwrap();
      onCreated();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-3 rounded-lg border border-border bg-background space-y-3">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Sprint name (e.g. Sprint 1)"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
      />
      <Input
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder="Sprint goal (optional)"
      />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Start date
          </label>
          <DatePicker value={startDate} onChange={setStartDate} />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            End date
          </label>
          <DatePicker value={endDate} onChange={setEndDate} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleCreate} disabled={!name.trim() || isSubmitting}>
          {isSubmitting ? "Creating..." : "Create Sprint"}
        </Button>
      </div>
    </div>
  );
}

// ===== Status Badge =====

function StatusBadge({ status }: { status: Sprint["status"] }) {
  const config = {
    active: { label: "Active", className: "bg-green-500/10 text-green-600 dark:text-green-400" },
    planned: { label: "Planned", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
    closed: { label: "Closed", className: "bg-muted text-muted-foreground" },
  }[status];

  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider shrink-0",
        config.className
      )}
    >
      {config.label}
    </span>
  );
}
