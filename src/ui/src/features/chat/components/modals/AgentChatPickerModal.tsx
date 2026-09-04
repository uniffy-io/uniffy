import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { closeAgentChatPicker } from "@/features/chat/store/chatUiSlice";
import { createAgentChat } from "@/features/chat/store/chatThunks";
import { selectAllAgents } from "@/features/agents/store/agentsSlice";
import { fetchAgents } from "@/features/agents/store/agentsThunks";
import { AgentAvatar } from "@/features/agents/components/AgentAvatar";
import { cn } from "@/shared/utils/cn";

export function AgentChatPickerModal() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const agentsMap = useAppSelector(selectAllAgents);
  const agents = useMemo(() => Object.values(agentsMap), [agentsMap]);

  const [query, setQuery] = useState("");
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  useEffect(() => {
    if (Object.keys(agentsMap).length === 0) {
      dispatch(fetchAgents());
    }
  }, [dispatch, agentsMap]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = agents.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return list;
    return list.filter((a) => a.name.toLowerCase().includes(q));
  }, [agents, query]);

  const handleClose = useCallback(() => {
    dispatch(closeAgentChatPicker());
    setQuery("");
  }, [dispatch]);

  const handlePick = async (agentId: string) => {
    setSubmittingId(agentId);
    try {
      const result = await dispatch(createAgentChat({ agentId })).unwrap();
      handleClose();
      navigate(`/chat/${result.id}`);
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <Modal onClose={handleClose} closeDisabled={submittingId !== null} maxWidth="max-w-md">
      <div data-testid="agent-chat-picker-modal">
        <ModalHeader
          title="New agent chat"
          description="You can have multiple chats with the same agent."
        />

        <ModalBody scrollable={false}>
          <div className="relative">
            <MagnifyingGlass
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="text"
              placeholder="Search agents..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
              autoFocus
            />
          </div>

          <div className="max-h-[50dvh] overflow-y-auto -mx-2">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                {query ? "No agents match your search." : "No agents available."}
              </div>
            ) : (
              <ul className="space-y-px">
                {filtered.map((agent) => {
                  const isSubmitting = submittingId === agent.id;
                  return (
                    <li key={agent.id}>
                      <button
                        type="button"
                        onClick={() => handlePick(agent.id)}
                        disabled={submittingId !== null}
                        className={cn(
                          "flex items-center gap-3 w-full px-3 py-2 rounded-md text-left transition-colors",
                          "hover:bg-muted/60 disabled:opacity-50 disabled:cursor-not-allowed",
                        )}
                        data-testid={`agent-chat-picker-option-${agent.id}`}
                      >
                        <AgentAvatar
                          avatarKey={agent.avatarKey}
                          avatarEmoji={agent.avatarEmoji}
                          agentName={agent.name}
                          size="sm"
                        />
                        <span className="flex-1 truncate text-sm font-medium text-foreground">
                          {agent.name}
                        </span>
                        {isSubmitting && (
                          <span className="text-xs text-muted-foreground">Creating...</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </ModalBody>

        <ModalFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={submittingId !== null}
          >
            Cancel
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
