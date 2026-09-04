import { useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createEventTemplate, updateEventTemplate } from "@/features/calendar/store/calendarThunks";
import { AccessMode } from "@uniffy/proto/common/v1/common_pb";

interface CreateTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateTemplateModal({ isOpen, onClose }: CreateTemplateModalProps) {
  const dispatch = useAppDispatch();
  const categories = useAppSelector((state) => state.calendar.categories);
  const templates = useAppSelector((state) => state.calendar.templates);
  const editingTemplateId = useAppSelector((state) => state.calendarUi.editingTemplateId);
  const isLoading = useAppSelector((state) => state.calendar.loading.templates);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [duration, setDuration] = useState(60);
  const [location, setLocation] = useState("");

  // Render-phase reset keyed on (open + edit target) avoids an effect-loop.
  const [formKey, setFormKey] = useState("");
  const currentFormKey = isOpen ? `open-${editingTemplateId ?? "new"}` : "closed";
  if (currentFormKey !== formKey) {
    setFormKey(currentFormKey);
    if (isOpen) {
      if (editingTemplateId && templates[editingTemplateId]) {
        const t = templates[editingTemplateId];
        setName(t.title);
        setDescription(t.description || "");
        setSelectedCategoryId(t.categoryId || "");
        setDuration(t.durationMinutes || 60);
        setLocation(t.location || "");
      } else {
        setName("");
        setDescription("");
        setSelectedCategoryId("");
        setDuration(60);
        setLocation("");
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      return;
    }

    try {
      if (editingTemplateId) {
        await dispatch(
          updateEventTemplate({
            id: editingTemplateId,
            title: name.trim(),
            description,
            durationMinutes: duration,
            categoryId: selectedCategoryId || undefined,
            location,
          }),
        ).unwrap();
      } else {
        await dispatch(
          createEventTemplate({
            title: name.trim(),
            description,
            durationMinutes: duration,
            categoryId: selectedCategoryId || undefined,
            location,
            meetingUrl: "",
            visibility: AccessMode.OWNER_ONLY,
            tags: [],
          }),
        ).unwrap();
      }

      onClose();
    } catch {}
  };

  if (!isOpen) return null;

  const categoryOptions = [
    { value: "", label: "No category" },
    ...Object.values(categories).map((category) => ({
      value: category.id,
      label: category.name,
    })),
  ];
  const isEditing = !!editingTemplateId;

  return (
    <Modal onClose={onClose} closeDisabled={isLoading} maxWidth="max-w-md">
      <form onSubmit={handleSubmit}>
        <ModalHeader title={isEditing ? "Edit template" : "New template"} />

        <ModalBody>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Name</label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Daily Standup, Code Review"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">
              Description (optional)
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add notes about this template..."
              rows={3}
            />
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">Location (optional)</label>
            <Input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Conference Room A or Zoom Link"
            />
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">Category</label>
            <Select
              value={selectedCategoryId}
              onChange={setSelectedCategoryId}
              options={categoryOptions}
              size="md"
            />
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">
              Default duration (minutes)
            </label>
            <NumberInput
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value))}
              min="15"
              step="15"
              className="text-foreground"
            />
          </div>
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button type="submit" loading={isLoading} disabled={!name.trim() || isLoading}>
            {isLoading ? "Saving..." : isEditing ? "Save changes" : "Create template"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
