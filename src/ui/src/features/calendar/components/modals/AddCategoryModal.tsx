import { useState, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { createCategory, updateCategory } from "@/features/calendar/store/calendarThunks";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";

interface AddCategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CATEGORY_COLORS = [
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#f43f5e", // rose
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
];

export function AddCategoryModal({ isOpen, onClose }: AddCategoryModalProps) {
  const dispatch = useAppDispatch();
  const categories = useAppSelector((state) => state.calendar.categories);
  const editingCategoryId = useAppSelector((state) => state.calendarUi.editingCategoryId);

  const [name, setName] = useState("");
  const [selectedColor, setSelectedColor] = useState(CATEGORY_COLORS[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (editingCategoryId && categories[editingCategoryId]) {
        const category = categories[editingCategoryId];
        // The modal stays mounted and only renders null while closed, so each open reseeds the form.
        // eslint-disable-next-line react/react-compiler
        setName(category.name);
        setSelectedColor(category.color);
      } else {
        setName("");
        setSelectedColor(CATEGORY_COLORS[0]);
      }
      setError(null);
    }
  }, [isOpen, editingCategoryId, categories]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError("Please enter a category name");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      if (editingCategoryId) {
        await dispatch(
          updateCategory({
            categoryId: editingCategoryId,
            name: name.trim(),
            color: selectedColor,
          }),
        ).unwrap();
      } else {
        await dispatch(
          createCategory({
            name: name.trim(),
            color: selectedColor,
          }),
        ).unwrap();
      }

      onClose();
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to save category. Please try again.";
      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const isEditing = !!editingCategoryId;

  return (
    <Modal onClose={onClose} closeDisabled={isSubmitting} maxWidth="max-w-md">
      <form onSubmit={handleSubmit}>
        <ModalHeader title={isEditing ? "Edit category" : "New category"} />

        <ModalBody>
          {error && <div className="p-3 rounded-md text-sm status-error">{error}</div>}

          <div>
            <label className="block text-sm text-muted-foreground mb-1">Name</label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Work, Personal"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">Color</label>
            <div className="grid grid-cols-5 gap-2">
              {CATEGORY_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setSelectedColor(color)}
                  className={cn(
                    "focus-ring w-8 h-8 rounded-full transition-transform hover:scale-110",
                    selectedColor === color
                      ? "ring-2 ring-offset-2 ring-primary ring-offset-background scale-110"
                      : "",
                  )}
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
          </div>
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : isEditing ? "Save changes" : "Create category"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
