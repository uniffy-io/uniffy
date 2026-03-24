/**
 * CreateCategoryModal - Modal for creating a new channel category.
 *
 * Simple form with just a category name. Categories organize channels
 * in the sidebar into collapsible groups.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, FolderSimplePlus } from '@phosphor-icons/react';
import { useAppDispatch } from '@/app/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { closeCreateCategoryModal } from '@/features/chat/store/chatUiSlice';
import { createCategoryThunk } from '@/features/chat/store/chatThunks';

export function CreateCategoryModal() {
  const dispatch = useAppDispatch();

  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = useCallback(() => {
    setName('');
    dispatch(closeCreateCategoryModal());
  }, [dispatch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      await dispatch(createCategoryThunk(name.trim())).unwrap();
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal onClose={handleClose} closeDisabled={isSubmitting} maxWidth="max-w-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <FolderSimplePlus size={20} weight="bold" className="text-primary" />
          <h3 className="text-lg font-semibold text-foreground">
            New Category
          </h3>
        </div>
        <button
          type="button"
          onClick={handleClose}
          disabled={isSubmitting}
          className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        >
          <X size={20} />
        </button>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit}>
        <div className="p-4 md:p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Category Name
            </label>
            <Input
              ref={inputRef}
              type="text"
              placeholder="e.g. Engineering, Marketing"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Categories organize channels into groups in the sidebar.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 bg-muted/30 border-t border-border">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || isSubmitting} loading={isSubmitting}>
            Create Category
          </Button>
        </div>
      </form>
    </Modal>
  );
}
