import { Fragment, useMemo, useState, useRef, useEffect } from "react";
import { X, PencilSimple, Trash, Check, Plus } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import { Input, controlShellClass } from "@/components/ui/input";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { moveTasksOutOfStatus } from "@/features/projects/store/projectsThunks";
import { selectTasksMap } from "@/features/projects/store/projectsSlice";
import { popoverShellClass } from "@/components/ui/popover";
import { statusPaint } from "@/features/projects/utils/statusPaint";
import { requiredStatusHint } from "@/features/projects/utils/statusSemantics";
import type { SelectOption } from "../../../types";

interface ManageStatusesDialogProps {
  options: SelectOption[];
  onSave: (options: SelectOption[]) => void;
  onClose: () => void;
}

// Colour comes from the status's slot on the brand axis; overrides live in project settings.
export function ManageStatusesDialog({ options, onSave, onClose }: ManageStatusesDialogProps) {
  const [items, setItems] = useState<SelectOption[]>([...options]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [newLabel, setNewLabel] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [moving, setMoving] = useState<{ fromId: string; toId: string } | null>(null);

  const dispatch = useAppDispatch();
  const projectId = useAppSelector((state) => state.projects.currentProjectId);
  const allTasks = useAppSelector(selectTasksMap);
  const taskCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const task of Object.values(allTasks)) {
      if (task.projectId === projectId && !task.deletedAt) {
        counts[task.status] = (counts[task.status] ?? 0) + 1;
      }
    }
    return counts;
  }, [allTasks, projectId]);

  const containerRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const newInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) {
      editInputRef.current?.focus();
    } else if (isAdding) {
      newInputRef.current?.focus();
    }
  }, [editingId, isAdding]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const handleUpdateItem = (id: string, updates: Partial<SelectOption>) => {
    const newItems = items.map((item) => (item.id === id ? { ...item, ...updates } : item));
    setItems(newItems);
    onSave(newItems);
  };

  const removeItem = (id: string) => {
    const newItems = items.filter((item) => item.id !== id);
    setItems(newItems);
    onSave(newItems);
  };

  // The server refuses to drop a status that live tasks still use, so they move first.
  const handleDeleteItem = (id: string) => {
    if ((taskCounts[id] ?? 0) === 0) {
      removeItem(id);
      return;
    }
    const firstOther = items.find((item) => item.id !== id);
    if (firstOther) setMoving({ fromId: id, toId: firstOther.id });
  };

  const handleMoveAndDelete = async () => {
    if (!moving || !projectId) return;
    const { fromId, toId } = moving;
    setMoving(null);
    const moved = await dispatch(
      moveTasksOutOfStatus({ projectId, fromStatus: fromId, toStatus: toId }),
    ).unwrap();
    if (moved) removeItem(fromId);
  };

  const handleAddNew = () => {
    if (!newLabel.trim()) return;

    const maxSortOrder = items.reduce((max, item) => Math.max(max, item.sortOrder), -1);

    // Empty colour: the backend assigns the new slot on the brand axis when it saves.
    const newOption: SelectOption = {
      id: `status_${crypto.randomUUID().slice(0, 8)}`,
      label: newLabel.trim(),
      color: "",
      sortOrder: maxSortOrder + 1,
    };

    const newItems = [...items, newOption];
    setItems(newItems);
    onSave(newItems);

    setNewLabel("");
    setIsAdding(false);
  };

  return (
    <div
      ref={containerRef}
      className={cn(popoverShellClass, "w-80 p-4 max-h-[500px] flex flex-col")}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-3 border-b border-border pb-2 shrink-0">
        <span className="text-sm font-medium text-foreground">Manage Statuses</span>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1 min-h-0 mb-3 pr-1">
        {items.map((item) => (
          <Fragment key={item.id}>
            <div className="flex items-center gap-2 group p-1.5 rounded hover:bg-muted/50 text-sm">
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ background: statusPaint(items, item.id).gradient }}
              />
              {editingId === item.id ? (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Input
                    ref={editInputRef}
                    className="flex-1 h-7 px-1.5 rounded text-xs"
                    value={item.label}
                    onChange={(e) => handleUpdateItem(item.id, { label: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "Escape") setEditingId(null);
                    }}
                  />
                  <button
                    onClick={() => setEditingId(null)}
                    className="p-1 text-primary hover:bg-primary/10 rounded"
                  >
                    <Check size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <span className="flex-1 truncate font-medium">{item.label}</span>

                  <div className="flex items-center gap-1 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                    <button
                      onClick={() => setEditingId(item.id)}
                      className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded"
                      title="Edit"
                    >
                      <PencilSimple size={14} />
                    </button>
                    <button
                      disabled={requiredStatusHint(item) !== null}
                      onClick={() => handleDeleteItem(item.id)}
                      className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted-foreground disabled:hover:bg-transparent"
                      title={requiredStatusHint(item) ?? "Delete"}
                      aria-label={`Delete ${item.label}`}
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
            {moving?.fromId === item.id && (
              <div className="mx-1.5 mb-1 space-y-2 rounded-md bg-muted/50 p-2 text-xs">
                <p className="text-muted-foreground">
                  {taskCounts[item.id]} task{taskCounts[item.id] === 1 ? " uses" : "s use"} this
                  status. Move {taskCounts[item.id] === 1 ? "it" : "them"} to:
                </p>
                <select
                  aria-label="Move tasks to"
                  value={moving.toId}
                  onChange={(e) => setMoving({ fromId: item.id, toId: e.target.value })}
                  className={cn(controlShellClass, "focus-ring w-full h-7 px-1.5 text-xs")}
                >
                  {items
                    .filter((other) => other.id !== item.id)
                    .map((other) => (
                      <option key={other.id} value={other.id}>
                        {other.label}
                      </option>
                    ))}
                </select>
                <div className="flex justify-end gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setMoving(null)}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="destructive" onClick={handleMoveAndDelete}>
                    Move and delete
                  </Button>
                </div>
              </div>
            )}
          </Fragment>
        ))}

        {items.length === 0 && (
          <div className="text-center py-4 text-xs text-muted-foreground italic">
            No statuses defined
          </div>
        )}
      </div>

      <div className="shrink-0 pt-2 border-t border-border">
        {isAdding ? (
          <div className="space-y-2">
            <Input
              ref={newInputRef}
              type="text"
              placeholder="Status name"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddNew();
                if (e.key === "Escape") setIsAdding(false);
              }}
              className="h-8 px-2 rounded"
            />
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={() => setIsAdding(false)}
              >
                Cancel
              </Button>
              <Button size="sm" className="h-7 px-2" onClick={handleAddNew}>
                Add
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full border-dashed text-muted-foreground"
            onClick={() => setIsAdding(true)}
          >
            <Plus size={14} className="mr-2" />
            Add Status
          </Button>
        )}
      </div>
    </div>
  );
}
