import { useState } from "react";
import { FloppyDisk, Plus, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MemoryCategory } from "@uniffy/proto/agents/v1/memories_pb";
import type { SerializedMemory } from "@/features/agents/store/agentMemoriesThunks";
import { CATEGORY_EDIT_OPTIONS } from "@/features/agents/components/memory/memoryCategories";

export interface MemoryFormValues {
  description: string;
  content: string;
  category: number;
  importance: number;
}

function FormFields({
  form,
  onChange,
}: {
  form: MemoryFormValues;
  onChange: (next: MemoryFormValues) => void;
}) {
  return (
    <>
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
        <Input
          type="text"
          value={form.description}
          onChange={(e) => onChange({ ...form, description: e.target.value })}
          placeholder="One-line summary shown in the agent's memory index"
          maxLength={255}
          required
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Content</label>
        <Textarea
          value={form.content}
          onChange={(e) => onChange({ ...form, content: e.target.value })}
          placeholder="What should the agent remember?"
          className="resize-y min-h-[60px]"
          rows={3}
        />
      </div>
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Category</label>
          <Select
            value={String(form.category)}
            onChange={(val) => onChange({ ...form, category: Number(val) })}
            options={CATEGORY_EDIT_OPTIONS}
          />
        </div>
        <div className="flex-1">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Importance ({form.importance.toFixed(1)})
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={form.importance}
            onChange={(e) => onChange({ ...form, importance: parseFloat(e.target.value) })}
            className="w-full accent-primary"
          />
        </div>
      </div>
    </>
  );
}

export function MemoryEditForm({
  memory,
  onSave,
  onCancel,
}: {
  memory: SerializedMemory;
  onSave: (values: MemoryFormValues) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<MemoryFormValues>({
    description: memory.description,
    content: memory.content,
    category: memory.category,
    importance: memory.importance,
  });

  const canSave = form.description.trim() && form.content.trim();

  return (
    <div className="space-y-3 p-3 bg-muted/50 rounded-md border border-border">
      <FormFields form={form} onChange={setForm} />
      <div className="flex items-center gap-2 justify-end">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          <X size={14} />
          Cancel
        </Button>
        <Button size="sm" onClick={() => onSave(form)} disabled={!canSave}>
          <FloppyDisk size={14} />
          Save
        </Button>
      </div>
    </div>
  );
}

const INITIAL_CREATE_FORM: MemoryFormValues = {
  description: "",
  content: "",
  category: MemoryCategory.FACTS,
  importance: 0.5,
};

export function MemoryCreateForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (values: MemoryFormValues & { key: string }) => void;
  onCancel: () => void;
}) {
  const [key, setKey] = useState("");
  const [form, setForm] = useState<MemoryFormValues>(INITIAL_CREATE_FORM);

  const canSubmit = key.trim() && form.description.trim() && form.content.trim();

  return (
    <div className="overflow-hidden rounded-xl bg-card shadow-edge">
      <div className="px-4 py-3 bg-muted/30 flex items-center gap-2">
        <Plus size={16} className="text-primary" />
        <span className="text-sm font-medium text-foreground">Add Memory</span>
      </div>
      <div className="p-4 space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Key</label>
          <Input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Short descriptive key (e.g. preferred_format, project_deadline)"
            onKeyDown={(e) => {
              if (e.key === "Escape") onCancel();
            }}
            autoFocus
          />
        </div>
        <FormFields form={form} onChange={setForm} />
        <div className="flex items-center gap-2 justify-end">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            <X size={14} />
            Cancel
          </Button>
          <Button size="sm" onClick={() => onSubmit({ ...form, key })} disabled={!canSubmit}>
            <Plus size={14} />
            Add Memory
          </Button>
        </div>
      </div>
    </div>
  );
}
