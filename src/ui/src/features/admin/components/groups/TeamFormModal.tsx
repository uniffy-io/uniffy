import { useState } from "react";
import { X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input, controlShellClass } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { cn } from "@/shared/utils/cn";
import { friendlyErrorMessage } from "@/config/errorMessages";
import { Select, type SelectOption } from "@/components/ui/select";
import type { SerializedGroupInfo } from "@/features/admin/store/adminSlice";
import { SubjectAvatarById } from "@/components/subject/SubjectAvatar";
import { SubjectPicker } from "@/components/subject/SubjectPicker";
import { useSubjectResolver } from "@/components/subject";

export interface TeamFormValues {
  name: string;
  description: string;
  leadUserId?: string;
  parentGroupId?: string;
  clearLead?: boolean;
  clearParentGroup?: boolean;
}

interface TeamFormModalProps {
  team?: SerializedGroupInfo | null;
  allTeams: SerializedGroupInfo[];
  onSave: (values: TeamFormValues) => Promise<void>;
  onClose: () => void;
}

export function TeamFormModal({ team, allTeams, onSave, onClose }: TeamFormModalProps) {
  const [name, setName] = useState(team?.name || "");
  const [description, setDescription] = useState(team?.description || "");
  const [leadUserId, setLeadUserId] = useState<string | null>(team?.leadUserId ?? null);
  const [parentGroupId, setParentGroupId] = useState<string>(team?.parentGroupId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { subjects: leadSubjects } = useSubjectResolver(leadUserId ? [leadUserId] : []);
  const leadSubject = leadSubjects[0];

  const parentOptions: SelectOption[] = [
    { value: "", label: "No parent team" },
    ...allTeams.filter((t) => t.id !== team?.id).map((t) => ({ value: t.id, label: t.name })),
  ];

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
        leadUserId: leadUserId ?? undefined,
        parentGroupId: parentGroupId || undefined,
        clearLead: Boolean(team?.leadUserId && !leadUserId),
        clearParentGroup: Boolean(team?.parentGroupId && !parentGroupId),
      });
      onClose();
    } catch (err) {
      // unwrap() rejects with a SerializedError plain object, not an Error.
      const raw = (err as { message?: string })?.message ?? String(err);
      setError(friendlyErrorMessage(raw) || "Failed to save team");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} closeDisabled={saving} maxWidth="max-w-md">
      <form onSubmit={handleSubmit}>
        <ModalHeader
          title={team ? "Edit team" : "New team"}
          description={
            team
              ? undefined
              : "Teams show up in the people directory and can be mentioned anywhere with @."
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
              placeholder="Engineering"
            />
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">
              Description (optional)
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this team does"
              rows={3}
            />
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">Team lead (optional)</label>
            {leadUserId ? (
              <div
                className={cn(
                  controlShellClass,
                  "hover:border-border flex items-center gap-2.5 px-3 py-2",
                )}
              >
                <SubjectAvatarById userId={leadUserId} displayName={leadSubject?.name} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {leadSubject?.name ?? leadUserId.slice(-6)}
                </span>
                <button
                  type="button"
                  onClick={() => setLeadUserId(null)}
                  className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  aria-label="Clear team lead"
                >
                  <X size={14} weight="bold" />
                </button>
              </div>
            ) : (
              <SubjectPicker
                mode="single"
                subjectTypes="users"
                value={[]}
                onChange={(_ids, subjects) => {
                  const subject = subjects[0];
                  if (subject) setLeadUserId(subject.id);
                }}
                placeholder="Search for a lead..."
              />
            )}
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">
              Parent team (optional)
            </label>
            <Select
              value={parentGroupId}
              onChange={setParentGroupId}
              options={parentOptions}
              ariaLabel="Parent team"
              menuMinWidth={200}
            />
          </div>
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={saving}>
            {saving ? "Saving..." : team ? "Save changes" : "Create team"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
