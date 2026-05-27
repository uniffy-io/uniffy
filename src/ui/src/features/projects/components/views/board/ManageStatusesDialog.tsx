import { useState, useRef, useEffect } from "react";
import { X, PencilSimple, Trash, Check, Plus } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import type { SelectOption } from "../../../types";

const STATUS_COLORS = [
  "#6b7280", "#3b82f6", "#22c55e", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#06b6d4", "#f97316", "#14b8a6",
];

interface ManageStatusesDialogProps {
  options: SelectOption[];
  onSave: (options: SelectOption[]) => void;
  onClose: () => void;
}

export function ManageStatusesDialog({ options, onSave, onClose }: ManageStatusesDialogProps) {
  const [items, setItems] = useState<SelectOption[]>([...options]);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // New Status State
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState(STATUS_COLORS[0]);
  const [isAdding, setIsAdding] = useState(false);
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const newInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus appropriate input
    if (editingId) {
      editInputRef.current?.focus();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting color picker when switching to edit mode
      setIsColorPickerOpen(false);
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
    const newItems = items.map(item => 
      item.id === id ? { ...item, ...updates } : item
    );
    setItems(newItems);
    onSave(newItems);
  };

  const handleDeleteItem = (id: string) => {
    const newItems = items.filter(item => item.id !== id);
    setItems(newItems);
    onSave(newItems);
  };

  const handleAddNew = () => {
    if (!newLabel.trim()) return;
    
    // Sort order should be max + 1
    const maxSortOrder = items.reduce((max, item) => Math.max(max, item.sortOrder), -1);

    const newOption: SelectOption = {
      id: `status_${crypto.randomUUID().slice(0, 8)}`,
      label: newLabel.trim(),
      color: newColor,
      sortOrder: maxSortOrder + 1,
    };
    
    const newItems = [...items, newOption];
    setItems(newItems);
    onSave(newItems);
    
    setNewLabel("");
    setNewColor(STATUS_COLORS[0]);
    setIsAdding(false);
  };

  return (
    <div
      ref={containerRef}
      className="w-80 rounded-lg border border-border bg-card shadow-xl p-4 max-h-[500px] flex flex-col"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-3 border-b border-border pb-2 shrink-0">
        <span className="text-sm font-medium text-foreground">Manage Statuses</span>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1 min-h-0 mb-3 pr-1">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2 group p-1.5 rounded hover:bg-muted/50 text-sm">
            {editingId === item.id ? (
              <div className="flex items-center gap-2 w-full relative">
                {/* Color Picker (Mini) */}
                <div className="relative">
                  <div 
                    className="w-4 h-4 rounded-full cursor-pointer ring-1 ring-border hover:ring-primary transition-all"
                    style={{ backgroundColor: item.color }}
                    onClick={(e) => {
                      e.stopPropagation(); // prevent closing dialog
                      setIsColorPickerOpen(!isColorPickerOpen);
                    }}
                  />
                  {isColorPickerOpen && (
                    <div className="absolute top-6 left-0 z-20 p-1.5 bg-popover border border-border rounded shadow-lg flex flex-wrap gap-1 w-32 animate-in fade-in zoom-in-95 duration-100">
                     {STATUS_COLORS.map(c => (
                       <button
                         key={c}
                         className="w-4 h-4 rounded-full hover:scale-110 transition-transform ring-1 ring-border/50"
                         style={{ backgroundColor: c }}
                         onClick={(e) => {
                           e.stopPropagation();
                           handleUpdateItem(item.id, { color: c });
                           setIsColorPickerOpen(false);
                         }}
                       />
                     ))}
                    </div>
                  )}
                </div>

                <input
                    ref={editInputRef}
                    className="flex-1 h-7 px-1.5 bg-background border border-border rounded text-xs"
                    value={item.label}
                    onChange={(e) => handleUpdateItem(item.id, { label: e.target.value })}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          setEditingId(null);
                          setIsColorPickerOpen(false);
                        }
                        if (e.key === 'Escape') {
                          setEditingId(null);
                          setIsColorPickerOpen(false);
                        }
                    }}
                    // Removed onBlur to allow clicking color picker without closing edit mode
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
                    <div 
                        className="w-3 h-3 rounded-full shrink-0" 
                        style={{ backgroundColor: item.color }}
                    />
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

      {/* Add New Section */}
      <div className="shrink-0 pt-2 border-t border-border">
          {isAdding ? (
              <div className="space-y-2">
                  <input
                    ref={newInputRef}
                    type="text"
                    placeholder="Status name"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddNew();
                        if (e.key === "Escape") setIsAdding(false);
                    }}
                    className="w-full h-8 px-2 text-sm bg-background border border-border rounded outline-none text-foreground focus:border-primary"
                  />
                  <div className="flex items-center justify-between">
                      <div className="flex gap-1.5">
                        {STATUS_COLORS.slice(0, 5).map((c) => (
                            <button
                            key={c}
                            type="button"
                            onClick={() => setNewColor(c)}
                            className={cn(
                                "w-5 h-5 rounded-full transition-all",
                                newColor === c ? "ring-2 ring-offset-1 ring-offset-card ring-primary scale-110" : "hover:scale-110"
                            )}
                            style={{ backgroundColor: c }}
                            />
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setIsAdding(false)}>Cancel</Button>
                        <Button size="sm" className="h-7 px-2" onClick={handleAddNew}>Add</Button>
                      </div>
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
