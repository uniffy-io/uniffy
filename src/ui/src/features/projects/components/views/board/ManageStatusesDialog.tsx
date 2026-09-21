import { useState, useRef, useEffect } from "react";
import { X, PencilSimple, Trash, Check, Plus } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { popoverShellClass } from "@/components/ui/popover";
import { statusPaint } from "@/features/projects/utils/statusPaint";
import type { SelectOption } from "../../../types";
import { randomUUID } from "@/shared/utils/uuid";

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

  const handleDeleteItem = (id: string) => {
    const newItems = items.filter((item) => item.id !== id);
    setItems(newItems);
    onSave(newItems);
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
          <div
            key={item.id}
            className="flex items-center gap-2 group p-1.5 rounded hover:bg-muted/50 text-sm"
          >
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

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setEditingId(item.id)}
                    className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded"
                    title="Edit"
                  >
                    <PencilSimple size={14} />
                  </button>
                  <button
                    onClick={() => handleDeleteItem(item.id)}
                    className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded"
                    title="Delete"
                  >
                    <Trash size={14} />
                  </button>
                </div>
              </>
            )}
          </div>
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
