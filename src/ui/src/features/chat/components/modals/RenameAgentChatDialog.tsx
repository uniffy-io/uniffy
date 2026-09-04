/** Set/clear the user's customName for an agent chat; empty restores the server-generated default. */

import { useState, useEffect, useRef, useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import {
  closeRenameAgentChatDialog,
  selectRenameAgentChatChannelId,
} from "@/features/chat/store/chatUiSlice";
import { selectChannelById } from "@/features/chat/store/chatChannelsSlice";
import { renameAgentChat } from "@/features/chat/store/chatThunks";

const MAX_NAME_LENGTH = 200;

export function RenameAgentChatDialog() {
  const dispatch = useAppDispatch();
  const channelId = useAppSelector(selectRenameAgentChatChannelId);
  const channel = useAppSelector((state) =>
    channelId ? selectChannelById(state, channelId) : undefined,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // ChatPage mounts this dialog only while a rename target is set, so the seed runs once per open.
  // Re-seeding from the channel row would wipe what the user typed whenever that row updates.
  const [value, setValue] = useState(() => channel?.customName ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = useCallback(() => {
    dispatch(closeRenameAgentChatDialog());
    setValue("");
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
      await dispatch(renameAgentChat({ channelId: channel.id, customName: null })).unwrap();
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!channel) return null;

  const tooLong = value.length > MAX_NAME_LENGTH;

  return (
    <Modal onClose={handleClose} closeDisabled={isSubmitting} maxWidth="max-w-md">
      <form onSubmit={handleSubmit} data-testid="rename-agent-chat-dialog">
        <ModalHeader
          title="Rename chat"
          description={
            <>
              Default name: <span className="font-medium text-foreground">{channel.name}</span>
            </>
          }
        />

        <ModalBody>
          <div>
            <label
              htmlFor="rename-agent-chat-input"
              className="block text-sm text-muted-foreground mb-1"
            >
              Custom name
            </label>
            <Input
              id="rename-agent-chat-input"
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Leave empty to use the default name"
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
        </ModalBody>

        <ModalFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={handleReset}
            disabled={isSubmitting || !channel.customName}
            className="mr-auto"
            data-testid="rename-agent-chat-reset"
          >
            Reset to default
          </Button>
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
        </ModalFooter>
      </form>
    </Modal>
  );
}
