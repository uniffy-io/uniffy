/**
 * RenameAgentChatDialog - Set or clear the user's custom name for an agent chat.
 *
 * The auto-generated `name` is preserved on the server; clearing the override
 * (empty input) restores the default agent name on every surface.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import {
  closeRenameAgentChatDialog,
  selectRenameAgentChatChannelId,
} from '@/features/chat/store/chatUiSlice';
import { selectChannelById } from '@/features/chat/store/chatChannelsSlice';
import { renameAgentChat } from '@/features/chat/store/chatThunks';

const MAX_NAME_LENGTH = 200;

export function RenameAgentChatDialog() {
  const dispatch = useAppDispatch();
  const channelId = useAppSelector(selectRenameAgentChatChannelId);
  const channel = useAppSelector((state) =>
    channelId ? selectChannelById(state, channelId) : undefined,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  const [value, setValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (channel) {
      setValue(channel.customName ?? '');
    }
  }, [channel]);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = useCallback(() => {
    dispatch(closeRenameAgentChatDialog());
    setValue('');
  }, [dispatch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channel) return;
    setIsSubmitting(true);
    try {
      const trimmed = value.trim();
      await dispatch(
        renameAgentChat({
          channelId: channel.id,
          customName: trimmed.length === 0 ? null : trimmed,
        }),
      ).unwrap();
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = async () => {
    if (!channel) return;
    setIsSubmitting(true);
    try {
      await dispatch(
        renameAgentChat({ channelId: channel.id, customName: null }),
      ).unwrap();
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!channel) return null;

  const tooLong = value.length > MAX_NAME_LENGTH;

  return (
    <Modal onClose={handleClose} maxWidth="max-w-md" closeDisabled={isSubmitting}>
      <form onSubmit={handleSubmit} className="p-5 space-y-4" data-testid="rename-agent-chat-dialog">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Rename chat</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Default name: <span className="font-medium text-foreground">{channel.name}</span>
          </p>
        </div>

        <div>
          <label htmlFor="rename-agent-chat-input" className="text-sm font-medium text-foreground">
            Custom name
          </label>
          <Input
            id="rename-agent-chat-input"
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Leave empty to use the default name"
            className="mt-1.5"
            maxLength={MAX_NAME_LENGTH + 1}
            disabled={isSubmitting}
            data-testid="rename-agent-chat-input"
          />
          {tooLong && (
            <p className="text-xs text-destructive mt-1">
              Name must be {MAX_NAME_LENGTH} characters or fewer.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={handleReset}
            disabled={isSubmitting || !channel.customName}
            data-testid="rename-agent-chat-reset"
          >
            Reset to default
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || tooLong}
              data-testid="rename-agent-chat-submit"
            >
              Save
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
