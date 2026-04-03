/**
 * CreateCategoryModal - Modal for creating a new channel category.
 *
 * Polished form with accent icon, name input with character counter,
 * and helper text. Categories organize channels in the sidebar
 * into collapsible groups.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, FolderSimplePlus, Rows } from '@phosphor-icons/react';
import { useAppDispatch } from '@/app/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/shared/utils/cn';
import { closeCreateCategoryModal } from '@/features/chat/store/chatUiSlice';
import { createCategoryThunk } from '@/features/chat/store/chatThunks';

const MAX_NAME_LENGTH = 40;

export function CreateCategoryModal() {
  const dispatch = useAppDispatch();

  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isNameValid = name.trim().length > 0;
  const showError = touched && !isNameValid;

  // Focus input on mount
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = useCallback(() => {
    setName('');
    setTouched(false);
    dispatch(closeCreateCategoryModal());
  }, [dispatch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!isNameValid) return;

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
      <div className="flex items-center justify-between px-6 pt-6 pb-2">
        <h2 className="text-xl font-semibold text-foreground">
          New category
        </h2>
        <button
          type="button"
          onClick={handleClose}
          disabled={isSubmitting}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        >
          <X size={20} />
        </button>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit}>
        <div className="px-6 py-4 space-y-5">
          {/* Illustration card */}
          <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Rows size={22} weight="bold" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Organize your channels</p>
              <p className="text-xs text-muted-foreground">
                Categories group channels into collapsible sections in the sidebar.
              </p>
            </div>
          </div>

          {/* Category name */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Category name
            </label>
            <Input
              ref={inputRef}
              type="text"
              placeholder="e.g. Engineering, Marketing, Design"
              value={name}
              onChange={(e) => {
                setName(e.target.value.slice(0, MAX_NAME_LENGTH));
                if (!touched) setTouched(true);
              }}
              disabled={isSubmitting}
              className={cn(
                showError && 'border-red-500 focus-visible:ring-red-500',
              )}
            />
            <div className="flex items-center justify-between mt-1">
              {showError ? (
                <p className="text-xs text-red-500">
                  Category name is required.
                </p>
              ) : (
                <span />
              )}
              <p className={cn(
                'text-xs tabular-nums',
                name.length >= MAX_NAME_LENGTH ? 'text-red-500' : 'text-muted-foreground',
              )}>
                {name.length}/{MAX_NAME_LENGTH}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!isNameValid || isSubmitting} loading={isSubmitting}>
            <FolderSimplePlus size={16} className="mr-1.5" />
            Create category
          </Button>
        </div>
      </form>
    </Modal>
  );
}
