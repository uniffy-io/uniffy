/** User-to-user DM modal (1:1 or group); agent conversations live elsewhere and must not appear here. */

import { useState, useCallback, useEffect, useRef } from "react";
import { X, MagnifyingGlass, Check, PaperPlaneTilt } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { controlShellClass } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { SubjectAvatar } from "@/components/subject";
import { cn } from "@/shared/utils/cn";
import { closeNewDmModal } from "@/features/chat/store/chatUiSlice";
import { createChannel, openSelfChat } from "@/features/chat/store/chatThunks";
import { selfConversationLabel } from "@/features/chat/utils/channelDisplay";
import { useSubjectSearch } from "@/components/subject/hooks/useSubjectSearch";
import { GROUP_DM_MAX_PARTICIPANTS, NEW_DM_MAX_RECIPIENTS } from "@/features/chat/utils/limits";
import { ChannelType } from "@uniffy/proto/chat/v1/chat_pb";
import type { Subject } from "@/components/subject/types";

export function NewDmModal() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const currentUserId = useAppSelector((s) => s.auth.user?.id ?? "");

  const [query, setQuery] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<Subject[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedUserIds = selectedUsers.map((s) => s.id);
  // Picking yourself alone opens your own conversation; beside others you are implicit.
  const recipients = selectedUsers.filter((s) => s.id !== currentUserId);
  const onlySelf = selectedUsers.length > 0 && recipients.length === 0;
  const atCap = recipients.length >= NEW_DM_MAX_RECIPIENTS;

  const { results, loading, search } = useSubjectSearch({
    subjectTypes: "users",
    excludeIds: selectedUserIds,
  });

  useEffect(() => {
    search(query);
  }, [query, search]);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = useCallback(() => {
    setQuery("");
    setSelectedUsers([]);
    dispatch(closeNewDmModal());
  }, [dispatch]);

  const handleToggleUser = useCallback(
    (subject: Subject) => {
      setSelectedUsers((prev) => {
        if (prev.find((s) => s.id === subject.id)) {
          return prev.filter((s) => s.id !== subject.id);
        }
        const recipientCount = prev.filter((s) => s.id !== currentUserId).length;
        if (subject.id !== currentUserId && recipientCount >= NEW_DM_MAX_RECIPIENTS) return prev;
        return [...prev, subject];
      });
      setQuery("");
      inputRef.current?.focus();
    },
    [currentUserId],
  );

  const handleRemoveUser = useCallback((id: string) => {
    setSelectedUsers((prev) => prev.filter((s) => s.id !== id));
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    if (selectedUsers.length === 0) return;

    setIsSubmitting(true);
    try {
      const channelType = recipients.length === 1 ? ChannelType.DIRECT : ChannelType.GROUP_DM;
      const result = onlySelf
        ? await dispatch(openSelfChat()).unwrap()
        : await dispatch(
            createChannel({ name: "", channelType, memberIds: recipients.map((s) => s.id) }),
          ).unwrap();

      navigate(`/chat/${result.id}`);
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && query === "" && selectedUsers.length > 0) {
      handleRemoveUser(selectedUsers[selectedUsers.length - 1].id);
    }
    if (e.key === "Enter" && selectedUsers.length > 0 && query === "") {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Modal
      onClose={handleClose}
      closeDisabled={isSubmitting}
      maxWidth="max-w-md"
      className="flex flex-col max-h-[85dvh]"
    >
      <div className="flex flex-col min-h-0" data-testid="chat-new-dm-modal">
        <ModalHeader title="New message" />

        <div className="px-6 py-4 border-b border-border shrink-0">
          <div
            className={cn(
              controlShellClass,
              "focus-ring-within flex flex-wrap items-center gap-1.5 px-3 py-2",
            )}
          >
            {selectedUsers.map((subject) => (
              <span
                key={`u-${subject.id}`}
                className="inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium"
              >
                {subject.id === currentUserId ? selfConversationLabel(subject.name) : subject.name}
                <button
                  type="button"
                  onClick={() => handleRemoveUser(subject.id)}
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
                placeholder={selectedUsers.length === 0 ? "Search people..." : "Add more..."}
                disabled={isSubmitting || atCap}
                className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-subtle-foreground"
                data-testid="chat-new-dm-search-input"
              />
            </div>
          </div>
          {selectedUsers.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1.5" data-testid="chat-new-dm-hint">
              {onlySelf
                ? "Opens your own conversation for notes, links, and files"
                : recipients.length === 1
                  ? "Press Enter or click below to start a conversation"
                  : `Group conversation with ${recipients.length + 1} of ${GROUP_DM_MAX_PARTICIPANTS} participants`}
            </p>
          )}
          {atCap && (
            <p
              className="text-xs text-amber-700 dark:text-amber-400 mt-1"
              data-testid="chat-new-dm-cap-notice"
            >
              Group chats are limited to {GROUP_DM_MAX_PARTICIPANTS} people. Create a channel for a
              bigger group.
            </p>
          )}
        </div>

        <ModalBody scrollable={false} className="flex-1 min-h-0 overflow-y-auto p-0 space-y-0">
          {loading && results.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">Searching...</div>
          ) : (
            <>
              {results.length > 0 && (
                <div className="py-1">
                  <div className="px-6 pt-2 pb-1 text-[10px] uppercase tracking-wide text-subtle-foreground">
                    People
                  </div>
                  {results.map((subject) => (
                    <button
                      key={subject.id}
                      type="button"
                      onClick={() => handleToggleUser(subject)}
                      className={cn(
                        "flex w-full items-center gap-3 px-6 py-2.5 text-left transition-colors hover:bg-muted",
                      )}
                      data-testid={`chat-new-dm-user-${subject.id}`}
                      data-selected={selectedUserIds.includes(subject.id) ? "true" : "false"}
                    >
                      <SubjectAvatar subject={subject} size="md" showPresence />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {subject.id === currentUserId
                            ? selfConversationLabel(subject.name)
                            : subject.name}
                        </p>
                        {subject.email && (
                          <p className="text-xs text-muted-foreground truncate">{subject.email}</p>
                        )}
                      </div>
                      {selectedUserIds.includes(subject.id) && (
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shrink-0">
                          <Check size={12} weight="bold" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {query.length >= 2 && results.length === 0 && (
                <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                  No matches
                </div>
              )}

              {query.length < 2 && results.length === 0 && (
                <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                  Type a name to find someone to message
                </div>
              )}
            </>
          )}
        </ModalBody>

        <ModalFooter className="shrink-0">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={isSubmitting}
            data-testid="chat-new-dm-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={selectedUsers.length === 0 || isSubmitting}
            loading={isSubmitting}
            data-testid="chat-new-dm-submit"
          >
            <PaperPlaneTilt size={16} />
            {recipients.length <= 1 ? "Start conversation" : "Create group"}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
