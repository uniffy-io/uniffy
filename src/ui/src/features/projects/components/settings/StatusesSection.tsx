import { useState, useRef, useEffect, useCallback } from "react";
import {
  CirclesThree,
  Trash,
  PencilSimple,
  Plus,
  Check,
  DotsSixVertical,
} from "@phosphor-icons/react";
import { useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input, controlShellClass } from "@/components/ui/input";
import { updateFieldThunk } from "@/features/projects/store/projectsThunks";
import { updateFieldDefinition } from "@/features/projects/store/projectsSlice";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import type { Project, SelectOption } from "@/features/projects/types";
import { STATUS_SWATCHES, statusPaint } from "@/features/projects/utils/statusPaint";
import { randomUUID } from "@/shared/utils/uuid";

interface StatusesSectionProps {
  project: Project;
}

// Colours default to the status's slot on the brand axis; the swatch row while editing overrides
// one status, and the reset action puts every status back on its slot.
export function StatusesSection({ project }: StatusesSectionProps) {
  const dispatch = useAppDispatch();
  const statusField = project.fieldDefinitions.find((f) => f.id === SYSTEM_FIELD_IDS.STATUS);
  const initialOptions = statusField?.config.options || [];

  const [items, setItems] = useState<SelectOption[]>([...initialOptions]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SelectOption | null>(null);
  const [migrationTargetId, setMigrationTargetId] = useState<string>("");

  const editInputRef = useRef<HTMLInputElement>(null);
  const newInputRef = useRef<HTMLInputElement>(null);

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Sync from project when field definitions update externally
  useEffect(() => {
    const field = project.fieldDefinitions.find((f) => f.id === SYSTEM_FIELD_IDS.STATUS);
    const opts = field?.config.options || [];
    // The list is reordered and edited locally before it is persisted, so it needs its own copy.
    // eslint-disable-next-line react/react-compiler
    setItems([...opts]);
  }, [project.fieldDefinitions]);

  useEffect(() => {
    if (editingId) {
      editInputRef.current?.focus();
    } else if (isAdding) {
      newInputRef.current?.focus();
    }
  }, [editingId, isAdding]);

  const persistOptions = useCallback(
    (newItems: SelectOption[]) => {
      if (!statusField) return;
      const updatedConfig = { ...statusField.config, options: newItems };

      dispatch(
        updateFieldDefinition({
          projectId: project.id,
          fieldId: SYSTEM_FIELD_IDS.STATUS,
          changes: { config: updatedConfig },
        }),
      );

      dispatch(
        updateFieldThunk({
          projectId: project.id,
          fieldId: SYSTEM_FIELD_IDS.STATUS,
          updates: { config: updatedConfig },
        }),
      );
    },
    [dispatch, project.id, statusField],
  );

  const handleUpdateItem = (id: string, updates: Partial<SelectOption>) => {
    const newItems = items.map((item) => (item.id === id ? { ...item, ...updates } : item));
    setItems(newItems);
    persistOptions(newItems);
  };

  // An empty colour asks the backend for the status's slot on the brand axis; the saved field
  // definition comes back filled and replaces this list.
  const handleResetColors = () => {
    const newItems = items.map((item) => ({ ...item, color: "" }));
    setItems(newItems);
    persistOptions(newItems);
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    const newItems = items.filter((item) => item.id !== deleteTarget.id);
    setItems(newItems);
    persistOptions(newItems);
    setDeleteTarget(null);
    setMigrationTargetId("");
  };

  const handleAddNew = () => {
    if (!newLabel.trim()) return;
    const maxSortOrder = items.reduce((max, item) => Math.max(max, item.sortOrder), -1);
    // Empty colour: the backend assigns the new slot on the brand axis when it saves.
    const newOption: SelectOption = {
      id: `status_${randomUUID().slice(0, 8)}`,
      label: newLabel.trim(),
      color: "",
      sortOrder: maxSortOrder + 1,
    };
    const newItems = [...items, newOption];
    setItems(newItems);
    persistOptions(newItems);
    setNewLabel("");
    setIsAdding(false);
  };

  // Drag handlers
  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (index: number) => {
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    const reordered = [...items];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(index, 0, moved);
    const withSortOrder = reordered.map((item, i) => ({ ...item, sortOrder: i }));
    setItems(withSortOrder);
    persistOptions(withSortOrder);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div className="space-y-8">
      {/* Section Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2 flex items-center gap-3">
          <CirclesThree size={24} weight="duotone" className="text-primary shrink-0" />
          Statuses
        </h1>
        <p className="text-muted-foreground">
          Configure task statuses and their order. The order controls the board columns and the
          dropdowns. Colours default to the brand axis, violet for the first status through pink for
          the last, and can be overridden per status while editing.
        </p>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Status Options</h2>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={handleResetColors}
          >
            Reset colours to brand
          </Button>
        </div>
        <div className="space-y-1 rounded-xl bg-surface p-4 shadow-edge md:p-6">
          {/* Status List */}
          {items.map((item, index) => (
            <div
              key={item.id}
              draggable={editingId !== item.id}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={() => handleDrop(index)}
              onDragEnd={() => {
                setDragIndex(null);
                setDragOverIndex(null);
              }}
              className={cn(
                "flex items-center gap-2 group p-2 rounded-lg border border-transparent transition-colors",
                "hover:bg-muted/50",
                dragOverIndex === index &&
                  dragIndex !== null &&
                  dragIndex !== index &&
                  "border-primary/50 bg-primary/5",
                dragIndex === index && "opacity-50",
              )}
            >
              {editingId === item.id ? (
                <div className="flex items-center gap-2 w-full">
                  <div
                    className="w-4 h-4 rounded-full shrink-0"
                    style={{ background: statusPaint(items, item.id).gradient }}
                  />
                  <Input
                    ref={editInputRef}
                    className="flex-1 h-8 px-2"
                    value={item.label}
                    onChange={(e) => handleUpdateItem(item.id, { label: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "Escape") setEditingId(null);
                    }}
                  />
                  <div className="flex items-center gap-1 shrink-0">
                    {STATUS_SWATCHES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        title={c}
                        onClick={() => handleUpdateItem(item.id, { color: c })}
                        className={cn(
                          "w-4 h-4 rounded-full transition-transform hover:scale-110",
                          item.color.toLowerCase() === c &&
                            "ring-2 ring-offset-1 ring-offset-surface ring-primary",
                        )}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="p-1 text-primary hover:bg-primary/10 rounded"
                  >
                    <Check size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <DotsSixVertical
                    size={16}
                    className="text-subtle-foreground cursor-grab shrink-0"
                  />
                  <div
                    className="w-4 h-4 rounded-full shrink-0"
                    style={{ background: statusPaint(items, item.id).gradient }}
                  />
                  <span className="flex-1 text-sm font-medium truncate">{item.label}</span>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => setEditingId(item.id)}
                      className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded"
                      title="Edit"
                    >
                      <PencilSimple size={14} />
                    </button>
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteTarget(item);
                          const firstOther = items.find((i) => i.id !== item.id);
                          setMigrationTargetId(firstOther?.id || "");
                        }}
                        className="p-1 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded"
                        title="Delete"
                      >
                        <Trash size={14} />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}

          {items.length === 0 && (
            <div className="text-center py-6 text-sm text-muted-foreground">
              No statuses defined. Add one below.
            </div>
          )}

          {/* Add New Section */}
          <div className="pt-4">
            {isAdding ? (
              <div className="space-y-3 rounded-xl bg-card p-3 shadow-edge">
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
                  className="h-9"
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setIsAdding(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleAddNew} disabled={!newLabel.trim()}>
                    Add
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="border-dashed text-muted-foreground"
                onClick={() => setIsAdding(true)}
              >
                <Plus size={14} className="mr-2" />
                Add Status
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => {
          setDeleteTarget(null);
          setMigrationTargetId("");
        }}
        onConfirm={handleDeleteConfirm}
        title="Delete Status"
        message={
          <div className="space-y-3">
            <p>
              Are you sure you want to delete the status &quot;{deleteTarget?.label}
              &quot;? Tasks using this status will need to be migrated to another status.
            </p>
            {items.filter((i) => i.id !== deleteTarget?.id).length > 0 && (
              <div>
                <label className="block text-sm font-medium mb-1">Move tasks to:</label>
                <select
                  value={migrationTargetId}
                  onChange={(e) => setMigrationTargetId(e.target.value)}
                  className={cn(
                    controlShellClass,
                    "focus-ring w-full h-9 px-2 text-sm text-foreground",
                  )}
                >
                  {items
                    .filter((i) => i.id !== deleteTarget?.id)
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.label}
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>
        }
        confirmLabel="Delete Status"
        variant="danger"
      />
    </div>
  );
}
