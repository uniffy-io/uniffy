import { useState, useRef, useEffect } from "react";
import { X, Plus, Trash, TextT, Hash, CaretDown, Calendar } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import type { FieldType, FieldDefinition, SelectOption } from "@/features/projects/types";

const CREATABLE_FIELDS: { type: FieldType; label: string; icon: React.ReactNode }[] = [
  { type: "text", label: "Text", icon: <TextT size={14} /> },
  { type: "number", label: "Number", icon: <Hash size={14} /> },
  { type: "single_select", label: "Select", icon: <CaretDown size={14} /> },
  { type: "date", label: "Date", icon: <Calendar size={14} /> },
];

const DEFAULT_OPTION_COLORS = [
  "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#6b7280", "#14b8a6",
];

interface CreateFieldDialogProps {
  projectId: string;
  onSubmit: (field: FieldDefinition) => void;
  onClose: () => void;
}

export function CreateFieldDialog({ projectId, onSubmit, onClose }: CreateFieldDialogProps) {
  const [name, setName] = useState("");
  const [fieldType, setFieldType] = useState<FieldType>("text");
  const [options, setOptions] = useState<SelectOption[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const handleAddOption = () => {
    const colorIdx = options.length % DEFAULT_OPTION_COLORS.length;
    setOptions([
      ...options,
      {
        id: `opt_${Date.now()}_${options.length}`,
        label: "",
        color: DEFAULT_OPTION_COLORS[colorIdx],
        sortOrder: options.length,
      },
    ]);
  };

  const handleRemoveOption = (idx: number) => {
    setOptions(options.filter((_, i) => i !== idx));
  };

  const handleOptionLabelChange = (idx: number, label: string) => {
    const updated = [...options];
    updated[idx] = { ...updated[idx], label };
    setOptions(updated);
  };

  const [colorPickerIdx, setColorPickerIdx] = useState<number | null>(null);

  const handleOptionColorChange = (idx: number, color: string) => {
    const updated = [...options];
    updated[idx] = { ...updated[idx], color };
    setOptions(updated);
    setColorPickerIdx(null);
  };

  const handleSubmit = () => {
    if (!name.trim()) return;

    const now = new Date().toISOString();
    const field: FieldDefinition = {
      id: `field_custom_${Date.now()}`,
      projectId,
      name: name.trim(),
      type: fieldType,
      isRequired: false,
      isSystem: false,
      sortOrder: 100,
      config: fieldType === "single_select"
        ? { options: options.filter((o) => o.label.trim()) }
        : {},
      createdAt: now,
      updatedAt: now,
    };

    onSubmit(field);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && name.trim()) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div
      ref={containerRef}
      className="absolute top-full right-0 z-50 mt-1 w-72 rounded-lg border border-border bg-card shadow-xl p-4"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-foreground">Add Field</span>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X size={14} />
        </button>
      </div>

      {/* Field Name */}
      <input
        ref={nameRef}
        type="text"
        placeholder="Field name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full h-8 px-2 mb-3 text-sm bg-background border border-border rounded outline-none text-foreground focus:border-primary"
      />

      {/* Field Type Selector */}
      <div className="mb-3">
        <span className="text-xs text-muted-foreground mb-1.5 block">Type</span>
        <div className="grid grid-cols-2 gap-1.5">
          {CREATABLE_FIELDS.map((info) => (
            <button
              key={info.type}
              type="button"
              onClick={() => {
                setFieldType(info.type);
                if (info.type === "single_select" && options.length === 0) {
                  handleAddOption();
                }
              }}
              className={cn(
                "flex items-center gap-2 px-2.5 py-1.5 rounded text-xs font-medium transition-colors",
                fieldType === info.type
                  ? "bg-primary/10 text-primary border border-primary/30"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted border border-transparent"
              )}
            >
              <span className="shrink-0">{info.icon}</span>
              {info.label}
            </button>
          ))}
        </div>
      </div>

      {/* Single Select Options */}
      {fieldType === "single_select" && (
        <div className="mb-3">
          <span className="text-xs text-muted-foreground mb-1.5 block">Options</span>
          <div className="space-y-1">
            {options.map((opt, idx) => (
              <div key={opt.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="w-5 h-5 rounded-full shrink-0 border border-border cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
                    style={{ backgroundColor: opt.color }}
                    onClick={() => setColorPickerIdx(colorPickerIdx === idx ? null : idx)}
                    title="Pick color"
                  />
                <input
                  type="text"
                  placeholder={`Option ${idx + 1}`}
                  value={opt.label}
                  onChange={(e) => handleOptionLabelChange(idx, e.target.value)}
                  className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded outline-none text-foreground focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => handleRemoveOption(idx)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash size={12} />
                </button>
                </div>
                {colorPickerIdx === idx && (
                  <div className="flex flex-wrap gap-1 pl-6 pb-1">
                    {DEFAULT_OPTION_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={cn(
                          "w-4 h-4 rounded-full border transition-all",
                          opt.color === c ? "border-foreground ring-1 ring-foreground" : "border-border hover:scale-110"
                        )}
                        style={{ backgroundColor: c }}
                        onClick={() => handleOptionColorChange(idx, c)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs w-full"
              onClick={handleAddOption}
            >
              <Plus size={12} className="mr-1" />
              Add option
            </Button>
          </div>
        </div>
      )}

      {/* Submit */}
      <Button
        size="sm"
        className="w-full h-8"
        disabled={!name.trim()}
        onClick={handleSubmit}
      >
        Create Field
      </Button>
    </div>
  );
}
