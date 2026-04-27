/**
 * NewDmModal - Modal for starting a new direct message conversation.
 *
 * Full-modal search experience: search input at top, results list below,
 * selected users/agents as chips. Creates DIRECT (1:1) or GROUP_DM (3+).
 * Agents are surfaced below the user results and submitted as polymorphic
 * chat subjects via the `members` field on CreateChannelRequest (Phase 1
 * contract).
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { X, MagnifyingGlass, Check, PaperPlaneTilt, Robot } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { SubjectAvatar } from '@/components/subject';
import { AgentAvatar } from '@/features/agents/components/AgentAvatar';
import { selectAllAgents } from '@/features/agents/store/agentsSlice';
import { cn } from '@/shared/utils/cn';
import { closeNewDmModal } from '@/features/chat/store/chatUiSlice';
import { createChannel } from '@/features/chat/store/chatThunks';
import { useSubjectSearch } from '@/components/subject/hooks/useSubjectSearch';
import { ChannelType } from '@uniffy/proto/chat/v1/chat_pb';
import type { Subject } from '@/components/subject/types';

const MAX_RECIPIENTS = 7;

interface SelectedAgent {
  id: string;
  name: string;
  avatarEmoji?: string;
  avatarKey?: string;
}

export function NewDmModal() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<Subject[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<SelectedAgent[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedUserIds = selectedUsers.map((s) => s.id);
  const selectedAgentIds = selectedAgents.map((a) => a.id);
  const totalSelected = selectedUsers.length + selectedAgents.length;

  const { results, loading, search } = useSubjectSearch({
    subjectTypes: 'users',
    excludeIds: selectedUserIds,
  });

  const agents = useAppSelector(selectAllAgents);
  const agentMatches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return Object.values(agents)
      .filter((a) => !selectedAgentIds.includes(a.id))
      .filter((a) => needle.length === 0 || a.name.toLowerCase().includes(needle))
      .slice(0, 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedAgentIds is derived from selectedAgents
  }, [agents, query, selectedAgents]);

  useEffect(() => {
    search(query);
  }, [query, search]);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = useCallback(() => {
    setQuery('');
    setSelectedUsers([]);
    setSelectedAgents([]);
    dispatch(closeNewDmModal());
  }, [dispatch]);

  const handleToggleUser = useCallback((subject: Subject) => {
    setSelectedUsers((prev) => {
      const exists = prev.find((s) => s.id === subject.id);
      if (exists) return prev.filter((s) => s.id !== subject.id);
      return prev;
    });
    setSelectedUsers((prev) => {
      if (prev.find((s) => s.id === subject.id)) return prev;
      if (totalSelected >= MAX_RECIPIENTS) return prev;
      return [...prev, subject];
    });
    setQuery('');
    inputRef.current?.focus();
  }, [totalSelected]);

  const handleToggleAgent = useCallback((agent: SelectedAgent) => {
    setSelectedAgents((prev) => {
      if (prev.find((a) => a.id === agent.id)) {
        return prev.filter((a) => a.id !== agent.id);
      }
      if (totalSelected >= MAX_RECIPIENTS) return prev;
      return [...prev, agent];
    });
    setQuery('');
    inputRef.current?.focus();
  }, [totalSelected]);

  const handleRemoveUser = useCallback((id: string) => {
    setSelectedUsers((prev) => prev.filter((s) => s.id !== id));
    inputRef.current?.focus();
  }, []);

  const handleRemoveAgent = useCallback((id: string) => {
    setSelectedAgents((prev) => prev.filter((a) => a.id !== id));
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    if (totalSelected === 0) return;

    setIsSubmitting(true);
    try {
      const channelType = totalSelected === 1 ? ChannelType.DIRECT : ChannelType.GROUP_DM;
      const hasAgent = selectedAgents.length > 0;

      // Mixed user+agent subjects go through the new `members` field (Phase
      // 1 contract). User-only DMs keep using legacy `memberIds` so that
      // code path remains exercised.
      const result = await dispatch(
        createChannel(
          hasAgent
            ? {
                name: '',
                channelType,
                subjects: [
                  ...selectedUserIds.map((id) => ({ type: 'USER' as const, id })),
                  ...selectedAgentIds.map((id) => ({ type: 'AGENT' as const, id })),
                ],
              }
            : { name: '', channelType, memberIds: selectedUserIds },
        ),
      ).unwrap();

      navigate(`/chat/${result.id}`);
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && query === '') {
      if (selectedAgents.length > 0) {
        handleRemoveAgent(selectedAgents[selectedAgents.length - 1].id);
      } else if (selectedUsers.length > 0) {
        handleRemoveUser(selectedUsers[selectedUsers.length - 1].id);
      }
    }
    if (e.key === 'Enter' && totalSelected > 0 && query === '') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Modal onClose={handleClose} closeDisabled={isSubmitting} maxWidth="max-w-md">
      <div className="flex flex-col" style={{ maxHeight: '70vh' }} data-testid="chat-new-dm-modal">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <h2 className="text-lg font-semibold text-foreground">New message</h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            data-testid="chat-new-dm-close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 pb-3 shrink-0">
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
            {selectedUsers.map((subject) => (
              <span
                key={`u-${subject.id}`}
                className="inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium"
              >
                {subject.name}
                <button
                  type="button"
                  onClick={() => handleRemoveUser(subject.id)}
                  className="hover:text-primary/70 ml-0.5"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            {selectedAgents.map((agent) => (
              <span
                key={`a-${agent.id}`}
                className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5 text-xs font-medium"
              >
                <Robot size={11} />
                {agent.name}
                <button
                  type="button"
                  onClick={() => handleRemoveAgent(agent.id)}
                  className="hover:opacity-70 ml-0.5"
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
                placeholder={totalSelected === 0 ? 'Search people or agents...' : 'Add more...'}
                disabled={isSubmitting || totalSelected >= MAX_RECIPIENTS}
                className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
                data-testid="chat-new-dm-search-input"
              />
            </div>
          </div>
          {totalSelected > 0 && (
            <p className="text-xs text-muted-foreground mt-1.5">
              {totalSelected === 1
                ? 'Press Enter or click below to start a conversation'
                : `Group conversation with ${totalSelected + 1} participants`}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto border-t border-border min-h-0">
          {loading && results.length === 0 && agentMatches.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">Searching...</div>
          ) : (
            <>
              {results.length > 0 && (
                <div className="py-1">
                  <div className="px-5 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground/60">
                    People
                  </div>
                  {results.map((subject) => (
                    <button
                      key={subject.id}
                      type="button"
                      onClick={() => handleToggleUser(subject)}
                      className={cn(
                        'flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-muted',
                      )}
                      data-testid={`chat-new-dm-user-${subject.id}`}
                      data-selected={selectedUserIds.includes(subject.id) ? 'true' : 'false'}
                    >
                      <SubjectAvatar subject={subject} size="md" showPresence />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{subject.name}</p>
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

              {agentMatches.length > 0 && (
                <div className="py-1">
                  <div className="px-5 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground/60">
                    Agents
                  </div>
                  {agentMatches.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() =>
                        handleToggleAgent({
                          id: agent.id,
                          name: agent.name,
                          avatarEmoji: agent.avatarEmoji,
                          avatarKey: agent.avatarKey,
                        })
                      }
                      className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-muted"
                      data-testid={`chat-new-dm-agent-${agent.id}`}
                      data-selected={selectedAgentIds.includes(agent.id) ? 'true' : 'false'}
                    >
                      <AgentAvatar
                        avatarKey={agent.avatarKey}
                        avatarEmoji={agent.avatarEmoji}
                        agentName={agent.name}
                        size="md"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{agent.name}</p>
                        <p className="text-xs text-muted-foreground truncate">Agent</p>
                      </div>
                      {selectedAgentIds.includes(agent.id) && (
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shrink-0">
                          <Check size={12} weight="bold" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {query.length >= 2 && results.length === 0 && agentMatches.length === 0 && (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">No matches</div>
              )}

              {query.length < 2 && results.length === 0 && agentMatches.length === 0 && (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                  Type a name to find someone or an agent to message
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-border shrink-0">
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
            disabled={totalSelected === 0 || isSubmitting}
            loading={isSubmitting}
            data-testid="chat-new-dm-submit"
          >
            <PaperPlaneTilt className="mr-1.5 h-4 w-4" />
            {totalSelected <= 1 ? 'Start conversation' : 'Create group'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
