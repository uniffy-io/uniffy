/**
 * Add Category Modal
 * Dialog for creating a new event category
 */

import { useState, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { createCategory, updateCategory } from '@/features/calendar/store/calendarThunks';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/components/ui/button';

interface AddCategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CATEGORY_COLORS = [
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f43f5e', // rose
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
];

export function AddCategoryModal({ isOpen, onClose }: AddCategoryModalProps) {
  const dispatch = useAppDispatch();
  const categories = useAppSelector((state) => state.calendar.categories);
  const editingCategoryId = useAppSelector((state) => state.calendarUi.editingCategoryId);
  
  const [name, setName] = useState('');
  const [selectedColor, setSelectedColor] = useState(CATEGORY_COLORS[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Populate form when editing
  useEffect(() => {
    if (isOpen) {
      if (editingCategoryId && categories[editingCategoryId]) {
        const category = categories[editingCategoryId];
        setName(category.name);
        setSelectedColor(category.color);
      } else {
        setName('');
        setSelectedColor(CATEGORY_COLORS[0]);
      }
      setError(null);
    }
  }, [isOpen, editingCategoryId, categories]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('Please enter a category name');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      if (editingCategoryId) {
        await dispatch(updateCategory({
          categoryId: editingCategoryId,
          name: name.trim(),
          color: selectedColor,
        })).unwrap();
      } else {
        await dispatch(createCategory({
          name: name.trim(),
          color: selectedColor,
        })).unwrap();
      }
      
      onClose();
    } catch (err: unknown) {
      console.error('Failed to save category:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to save category. Please try again.';
      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const isEditing = !!editingCategoryId;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-background rounded-lg shadow-lg z-50 w-[calc(100vw-2rem)] max-w-96 border border-border">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">
            {isEditing ? 'Edit Category' : 'New Category'}
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="text-sm p-3 rounded-md border status-error">
              {error}
            </div>
          )}
          
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-foreground"
              placeholder="e.g. Work, Personal"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Color
            </label>
            <div className="grid grid-cols-5 gap-2">
              {CATEGORY_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setSelectedColor(color)}
                  className={cn(
                    "w-8 h-8 rounded-full focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background transition-transform hover:scale-110",
                    selectedColor === color ? "ring-2 ring-offset-2 ring-primary ring-offset-background scale-110" : ""
                  )}
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="md"
              loading={isSubmitting}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Category'}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
