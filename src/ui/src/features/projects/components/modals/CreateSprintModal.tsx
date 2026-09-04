import { useState } from "react";
import { useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { createSprint } from "@/features/projects/store/sprintsThunks";

interface CreateSprintModalProps {
  projectId: string;
  onClose: () => void;
  onCreated?: () => void;
}

export function CreateSprintModal({ projectId, onClose, onCreated }: CreateSprintModalProps) {
  const dispatch = useAppDispatch();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Sprint name is required.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await dispatch(
        createSprint({
          projectId,
          name: name.trim(),
          goal: goal.trim() || undefined,
          startDate: startDate || null,
          endDate: endDate || null,
        }),
      ).unwrap();
      onCreated?.();
      onClose();
    } catch {
      setError("Failed to create sprint. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal onClose={onClose} closeDisabled={isSubmitting} maxWidth="max-w-md">
      <form onSubmit={handleSubmit}>
        <ModalHeader title="New sprint" />

        <ModalBody>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div>
            <label className="block text-sm text-muted-foreground mb-1">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sprint 1"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">Goal (optional)</label>
            <Input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="What is the goal of this sprint?"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Start date</label>
              <DatePicker
                value={startDate}
                onChange={setStartDate}
                placeholder="Pick start date"
                disabled={isSubmitting}
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">End date</label>
              <DatePicker
                value={endDate}
                onChange={setEndDate}
                placeholder="Pick end date"
                disabled={isSubmitting}
              />
            </div>
          </div>
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create sprint"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
