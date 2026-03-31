/**
 * NewDmModal - Modal for starting a new direct message conversation.
 *
 * Full-modal search experience: search input at top, results list below,
 * selected users as chips. Creates DIRECT (1:1) or GROUP_DM (3+).
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { X, MagnifyingGlass, Check, PaperPlaneTilt } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch } from '@/app/hooks';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { SubjectAvatar } from '@/components/subject';
import { cn } from '@/shared/utils/cn';
import { closeNewDmModal } from '@/features/chat/store/chatUiSlice';
import { createChannel } from '@/features/chat/store/chatThunks';
import { useSubjectSearch } from '@/components/subject/hooks/useSubjectSearch';
import { ChannelType } from '@uniffy/proto/chat/v1/chat_pb';
import type { Subject } from '@/components/subject/types';

const MAX_RECIPIENTS = 7;

export function NewDmModal() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Subject[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedIds = selected.map((s) => s.id);

  const { results, loading, search } = useSubjectSearch({
    subjectTypes: 'users',
    excludeIds: selectedIds,
  });

  useEffect(() => {
    search(query);
  }, [query, search]);

  // Focus input on mount
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = useCallback(() => {
    setQuery('');
    setSelected([]);
    dispatch(closeNewDmModal());
  }, [dispatch]);

  const handleToggle = useCallback((subject: Subject) => {
    setSelected((prev) => {
      const exists = prev.find((s) => s.id === subject.id);
      if (exists) {
        return prev.filter((s) => s.id !== subject.id);
      }
      if (prev.length >= MAX_RECIPIENTS) return prev;
      return [...prev, subject];
    });
    setQuery('');
    inputRef.current?.focus();
  }, []);

  const handleRemove = useCallback((id: string) => {
    setSelected((prev) => prev.filter((s) => s.id !== id));
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    if (selected.length === 0) return;

    setIsSubmitting(true);
    try {
      const channelType = selected.length === 1
        ? ChannelType.DIRECT
        : ChannelType.GROUP_DM;

      const result = await dispatch(
        createChannel({
          name: '',
          channelType,
          memberIds: selectedIds,
        })
      ).unwrap();

      navigate(`/chat/${result.id}`);
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && query === '' && selected.length > 0) {
      handleRemove(selected[selected.length - 1].id);
    }
    if (e.key === 'Enter' && selected.length > 0 && query === '') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Modal onClose={handleClose} closeDisabled={isSubmitting} maxWidth="max-w-md">
      <div className="flex flex-col" style={{ maxHeight: '70vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <h2 className="text-lg font-semibold text-foreground">New message</h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search + chips */}
        <div className="px-5 pb-3 shrink-0">
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
            {selected.map((subject) => (
              <span
                key={subject.id}
                className="inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium"
              >
                {subject.name}
                <button
                  type="button"
                  onClick={() => handleRemove(subject.id)}
                  className="hover:text-primary/70 ml-0.5"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <div className="flex flex-1 items-center gap-2 min-w-[120px]">
              <MagnifyingGlass size={14} className="text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={selected.length === 0 ? 'Search people...' : 'Add more...'}
                disabled={isSubmitting || selected.length >= MAX_RECIPIENTS}
                className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>
          {selected.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1.5">
              {selected.length === 1
                ? 'Press Enter or click below to start a conversation'
                : `Group conversation with ${selected.length + 1} people`}
            </p>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto border-t border-border min-h-0">
          {loading && results.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">Searching...</div>
          ) : query.length >= 2 && results.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">No people found</div>
          ) : results.length > 0 ? (
            <div className="py-1">
              {results.map((subject) => (
                <button
                  key={subject.id}
                  type="button"
                  onClick={() => handleToggle(subject)}
                  className={cn(
                    'flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-muted',
                  )}
                >
                  <SubjectAvatar subject={subject} size="md" showPresence />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{subject.name}</p>
                    {subject.email && (
                      <p className="text-xs text-muted-foreground truncate">{subject.email}</p>
                    )}
                  </div>
                  {selectedIds.includes(subject.id) && (
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shrink-0">
                      <Check size={12} weight="bold" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              Type a name to find someone to message
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-border shrink-0">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={selected.length === 0 || isSubmitting}
            loading={isSubmitting}
          >
            <PaperPlaneTilt className="mr-1.5 h-4 w-4" />
            {selected.length <= 1 ? 'Start conversation' : 'Create group'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
