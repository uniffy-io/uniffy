import { useState, useRef, useCallback } from "react";
import {
  Columns,
  Trash,
  PencilSimple,
  Plus,
  X,
  DotsSixVertical,
  TextT,
  Hash,
  CaretDown,
  ListChecks,
  CalendarBlank,
  User,
  Link,
} from "@phosphor-icons/react";
import { useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import {
  createFieldThunk,
  updateFieldThunk,
  deleteFieldThunk,
} from "@/features/projects/store/projectsThunks";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import type { Project, FieldDefinition, FieldType, SelectOption } from "@/features/projects/types";

const SYSTEM_IDS: Set<string> = new Set(Object.values(SYSTEM_FIELD_IDS));

const FIELD_TYPES: { type: FieldType; label: string; icon: React.ElementType }[] = [
  { type: "text", label: "Text", icon: TextT },
  { type: "number", label: "Number", icon: Hash },
  { type: "single_select", label: "Select", icon: CaretDown },
  { type: "multi_select", label: "Multi Select", icon: ListChecks },
  { type: "date", label: "Date", icon: CalendarBlank },
  { type: "person", label: "Person", icon: User },
  { type: "reference", label: "Reference", icon: Link },
];

const DEFAULT_OPTION_COLORS = [
  "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#6b7280",
];

function getFieldTypeConfig(type: FieldType) {
  return FIELD_TYPES.find((t) => t.type === type) || FIELD_TYPES[0];
}

interface CustomFieldsSectionProps {
  project: Project;
}

export function CustomFieldsSection({ project }: CustomFieldsSectionProps) {
  const dispatch = useAppDispatch();
  const customFields = project.fieldDefinitions.filter((f) => !f.isSystem && !SYSTEM_IDS.has(f.id));
  const systemFields = project.fieldDefinitions.filter((f) => f.isSystem || SYSTEM_IDS.has(f.id));

  // Create form state
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<FieldType>("text");
  const [newRequired, setNewRequired] = useState(false);
  const [newOptions, setNewOptions] = useState<SelectOption[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const newNameRef = useRef<HTMLInputElement>(null);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRequired, setEditRequired] = useState(false);
  const [editOptions, setEditOptions] = useState<SelectOption[]>([]);
  const editNameRef = useRef<HTMLInputElement>(null);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<FieldDefinition | null>(null);

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // --- Create handlers ---

  const resetCreateForm = useCallback(() => {
    setNewName("");
    setNewType("text");
    setNewRequired(false);
    setNewOptions([]);
    setIsCreating(false);
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setIsSubmitting(true);
    try {
      const field: Omit<FieldDefinition, "id" | "projectId" | "createdAt" | "updatedAt"> = {
        name: newName.trim(),
        type: newType,
        isRequired: newRequired,
        isSystem: false,
        sortOrder: customFields.length,
        config: (newType === "single_select" || newType === "multi_select")
          ? { options: newOptions.filter((o) => o.label.trim()) }
          : {},
      };
      await dispatch(createFieldThunk({ projectId: project.id, field })).unwrap();
      resetCreateForm();
    } finally {
      setIsSubmitting(false);
    }
  };

  const addNewOption = () => {
    const color = DEFAULT_OPTION_COLORS[newOptions.length % DEFAULT_OPTION_COLORS.length];
    setNewOptions([...newOptions, { id: `opt_${Date.now()}`, label: "", color, sortOrder: newOptions.length }]);
  };

  // --- Edit handlers ---

  const startEdit = (field: FieldDefinition) => {
    setEditingId(field.id);
    setEditName(field.name);
    setEditRequired(field.isRequired);
    setEditOptions(field.config.options ? [...field.config.options] : []);
    setTimeout(() => editNameRef.current?.focus(), 50);
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    const field = customFields.find((f) => f.id === editingId);
    if (!field) return;

    const updates: Partial<FieldDefinition> = {
      name: editName.trim(),
      isRequired: editRequired,
    };
    if (field.type === "single_select" || field.type === "multi_select") {
      updates.config = { ...field.config, options: editOptions.filter((o) => o.label.trim()) };
    }

    await dispatch(updateFieldThunk({ projectId: project.id, fieldId: editingId, updates }));
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const addEditOption = () => {
    const color = DEFAULT_OPTION_COLORS[editOptions.length % DEFAULT_OPTION_COLORS.length];
    setEditOptions([...editOptions, { id: `opt_${Date.now()}`, label: "", color, sortOrder: editOptions.length }]);
  };

  // --- Delete handler ---

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    await dispatch(deleteFieldThunk({ projectId: project.id, fieldId: deleteTarget.id }));
    setDeleteTarget(null);
  };

  // --- Drag handlers ---

  const handleDragStart = (index: number) => setDragIndex(index);
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };
  const handleDrop = async (index: number) => {
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    const reordered = [...customFields];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(index, 0, moved);
    for (let i = 0; i < reordered.length; i++) {
      if (reordered[i].sortOrder !== i) {
        dispatch(updateFieldThunk({
          projectId: project.id,
          fieldId: reordered[i].id,
          updates: { sortOrder: i },
        }));
      }
    }
    setDragIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div className="space-y-8">
      {/* Section Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2 flex items-center gap-3">
          <Columns size={24} weight="duotone" className="text-primary shrink-0" />
          Custom Fields
        </h1>
        <p className="text-muted-foreground">
          Define additional fields for tasks in this project.
        </p>
      </div>

      {/* System Fields */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">System Fields</h2>
        <div className="bg-card rounded-lg border border-border p-4 md:p-6">
          <div className="space-y-1">
            {systemFields.map((field) => {
              const typeConfig = getFieldTypeConfig(field.type);
              const TypeIcon = typeConfig.icon;
              return (
                <div key={field.id} className="flex items-center gap-3 p-2 rounded-lg text-muted-foreground">
                  <TypeIcon size={14} className="shrink-0" />
                  <span className="text-sm flex-1">{field.name}</span>
                  <span className="text-xs bg-muted px-2 py-0.5 rounded">{typeConfig.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Custom Fields */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Custom Fields</h2>
        <div className="bg-card rounded-lg border border-border p-4 md:p-6 space-y-4">
          {customFields.length === 0 && !isCreating && (
            <p className="text-sm text-muted-foreground">
              No custom fields yet. Add one below.
            </p>
          )}

          <div className="space-y-1">
            {customFields.map((field, index) => {
              const typeConfig = getFieldTypeConfig(field.type);
              const TypeIcon = typeConfig.icon;
              const isEditing = editingId === field.id;

              if (isEditing) {
                return (
                  <div key={field.id} className="p-3 rounded-lg border border-primary/30 bg-muted/30 space-y-3">
                    <div className="flex items-center gap-3">
                      <Input
                        ref={editNameRef}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Field name"
                        className="flex-1"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit();
                          if (e.key === "Escape") cancelEdit();
                        }}
                      />
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">Required</span>
                        <ToggleSwitch
                          enabled={editRequired}
                          onChange={setEditRequired}
                          size="sm"
                        />
                      </div>
                    </div>

                    {/* Options for select types */}
                    {(field.type === "single_select" || field.type === "multi_select") && (
                      <OptionsEditor
                        options={editOptions}
                        onChange={setEditOptions}
                        onAdd={addEditOption}
                      />
                    )}

                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={cancelEdit}>Cancel</Button>
                      <Button size="sm" onClick={saveEdit} disabled={!editName.trim()}>Save</Button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={field.id}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={() => handleDrop(index)}
                  onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
                  className={cn(
                    "flex items-center gap-3 group p-2 rounded-lg border border-transparent transition-colors",
                    "hover:bg-muted/50",
                    dragOverIndex === index && dragIndex !== null && dragIndex !== index && "border-primary/50 bg-primary/5",
                    dragIndex === index && "opacity-50",
                  )}
                >
                  <DotsSixVertical size={14} className="text-muted-foreground/40 cursor-grab shrink-0" />
                  <TypeIcon size={14} className="text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium flex-1 truncate">{field.name}</span>
                  {field.isRequired && (
                    <span className="text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded">Required</span>
                  )}
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{typeConfig.label}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => startEdit(field)}
                      className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded"
                      title="Edit"
                    >
                      <PencilSimple size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(field)}
                      className="p-1 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded"
                      title="Delete"
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Create Field Form */}
          {isCreating ? (
            <div className="p-4 rounded-lg border border-border bg-background space-y-4">
              <h4 className="text-sm font-medium">New Field</h4>

              {/* Name */}
              <Input
                ref={newNameRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Field name"
                onKeyDown={(e) => {
                  if (e.key === "Escape") resetCreateForm();
                }}
              />

              {/* Type Selector */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-2">Type</label>
                <div className="grid grid-cols-4 md:grid-cols-7 gap-1.5">
                  {FIELD_TYPES.map(({ type, label, icon: Icon }) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        setNewType(type);
                        if (type !== "single_select" && type !== "multi_select") {
                          setNewOptions([]);
                        }
                      }}
                      className={cn(
                        "flex flex-col items-center gap-1 p-2 rounded-md border text-xs transition-colors",
                        newType === type
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <Icon size={16} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Options for select types */}
              {(newType === "single_select" || newType === "multi_select") && (
                <OptionsEditor
                  options={newOptions}
                  onChange={setNewOptions}
                  onAdd={addNewOption}
                />
              )}

              {/* Required */}
              <div className="flex items-center gap-3">
                <ToggleSwitch
                  enabled={newRequired}
                  onChange={setNewRequired}
                  size="sm"
                />
                <span className="text-sm text-muted-foreground">Required field</span>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={resetCreateForm}>Cancel</Button>
                <Button onClick={handleCreate} disabled={!newName.trim() || isSubmitting}>
                  {isSubmitting ? "Creating..." : "Create Field"}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="border-dashed text-muted-foreground"
              onClick={() => {
                setIsCreating(true);
                setTimeout(() => newNameRef.current?.focus(), 50);
              }}
            >
              <Plus size={14} className="mr-2" />
              Add Field
            </Button>
          )}
        </div>
      </section>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Field"
        message={`Are you sure you want to delete the field "${deleteTarget?.name}"? This will remove the field and its values from all tasks. This cannot be undone.`}
        confirmLabel="Delete Field"
        variant="danger"
      />
    </div>
  );
}

// --- Options Editor Sub-component ---

interface OptionsEditorProps {
  options: SelectOption[];
  onChange: (options: SelectOption[]) => void;
  onAdd: () => void;
}

function OptionsEditor({ options, onChange, onAdd }: OptionsEditorProps) {
  const updateOption = (index: number, updates: Partial<SelectOption>) => {
    const updated = options.map((opt, i) => (i === index ? { ...opt, ...updates } : opt));
    onChange(updated);
  };

  const removeOption = (index: number) => {
    onChange(options.filter((_, i) => i !== index));
  };

  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-2">Options</label>
      <div className="space-y-1.5">
        {options.map((opt, index) => (
          <div key={opt.id} className="flex items-center gap-2">
            <div className="relative">
              <input
                type="color"
                value={opt.color}
                onChange={(e) => updateOption(index, { color: e.target.value })}
                className="w-6 h-6 rounded-full border border-border cursor-pointer p-0 appearance-none bg-transparent [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0"
              />
            </div>
            <input
              type="text"
              value={opt.label}
              onChange={(e) => updateOption(index, { label: e.target.value })}
              placeholder={`Option ${index + 1}`}
              className="flex-1 h-8 px-2 text-sm bg-background border border-border rounded-md outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => removeOption(index)}
              className="p-1 text-muted-foreground hover:text-red-500 rounded"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="flex items-center gap-1 mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Plus size={12} />
        Add option
      </button>
    </div>
  );
}
