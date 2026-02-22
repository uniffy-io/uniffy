import { useState } from "react";
import { X } from "@phosphor-icons/react";
import { useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
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
        })
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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card shadow-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-foreground">Create Sprint</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Sprint Name *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sprint 1"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Goal</label>
            <Input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="What is the goal of this sprint?"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Start Date</label>
              <DatePicker
                value={startDate}
                onChange={setStartDate}
                placeholder="Pick start date"
                disabled={isSubmitting}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">End Date</label>
              <DatePicker
                value={endDate}
                onChange={setEndDate}
                placeholder="Pick end date"
                disabled={isSubmitting}
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create Sprint"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
