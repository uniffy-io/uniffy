import { useState } from "react";
import { X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { friendlyErrorMessage } from "@/config/errorMessages";
import type { SerializedGroupInfo } from "@/features/admin/store/adminSlice";

export interface GroupFormValues {
  name: string;
  description: string;
  isPrivate: boolean;
}

interface GroupFormModalProps {
  group?: SerializedGroupInfo | null;
  onSave: (values: GroupFormValues) => Promise<void>;
  onClose: () => void;
}

export function GroupFormModal({ group, onSave, onClose }: GroupFormModalProps) {
  const [name, setName] = useState(group?.name || "");
  const [description, setDescription] = useState(group?.description || "");
  const [isPrivate, setIsPrivate] = useState(group?.isPrivate ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        isPrivate,
      });
      onClose();
    } catch (err) {
      // unwrap() rejects with a SerializedError plain object, not an Error.
      const raw = (err as { message?: string })?.message ?? String(err);
      setError(friendlyErrorMessage(raw) || "Failed to save group");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
      <div className="w-full sm:w-[calc(100vw-2rem)] sm:max-w-md bg-card rounded-t-xl sm:rounded-xl border border-border shadow-xl">
        <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-border">
          <h2 className="text-lg font-semibold">{group ? "Edit Group" : "Create Group"}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={20} weight="bold" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 md:p-6 space-y-4 max-h-[60vh] overflow-y-auto">
          {error && <div className="p-3 rounded-md text-sm status-error">{error}</div>}

          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Release approvers"
              className="w-full px-3 py-2 rounded-md border border-border bg-background
                                text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={3}
              className="w-full px-3 py-2 rounded-md border border-border bg-background
                                text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>

          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <span className="block text-sm font-medium">Private</span>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                A private group is invisible to members; use it for sensitive access lists.
              </p>
            </div>
            <ToggleSwitch enabled={isPrivate} onChange={setIsPrivate} />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" size="md" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="md" loading={saving} disabled={saving}>
              {saving ? "Saving..." : group ? "Save Changes" : "Create Group"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
