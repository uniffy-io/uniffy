import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
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
    <Modal onClose={onClose} closeDisabled={saving} maxWidth="max-w-md">
      <form onSubmit={handleSubmit}>
        <ModalHeader
          title={group ? "Edit group" : "New group"}
          description={
            group
              ? undefined
              : "Groups bundle people so you can share and grant access in one step."
          }
        />

        <ModalBody>
          {error && <div className="p-3 rounded-md text-sm status-error">{error}</div>}

          <div>
            <label className="block text-sm text-muted-foreground mb-1">Name</label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Release approvers"
            />
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">
              Description (optional)
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this group is for"
              rows={3}
            />
          </div>

          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <span className="block text-sm font-medium text-foreground">Private</span>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                A private group is invisible to members; use it for sensitive access lists.
              </p>
            </div>
            <ToggleSwitch enabled={isPrivate} onChange={setIsPrivate} />
          </div>
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={saving}>
            {saving ? "Saving..." : group ? "Save changes" : "Create group"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
