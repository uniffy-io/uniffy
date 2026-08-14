import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDown, Gauge, X } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { AgentAvatar } from "@/features/agents/components/AgentAvatar";
import { AgentContextBar } from "@/features/chat/components/channel/AgentContextBar";
import { selectChannelMembers } from "@/features/chat/store/chatChannelsSlice";
import { useChannelAgentContextBatch } from "@/features/chat/hooks/useChannelAgentContext";
import { useChatPermissions } from "@/features/chat/hooks/useChatPermissions";
import { cn } from "@/shared/utils/cn";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { Drawer } from "@/components/ui/drawer";

interface ChannelAgentsPopoverProps {
  channelId: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

export function ChannelAgentsPopover({ channelId, anchorRef, onClose }: ChannelAgentsPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const members = useAppSelector((s) => selectChannelMembers(s, channelId));
  const agentsById = useAppSelector((s) => s.agents.agents);
  const currentUserId = useAppSelector((s) => s.auth.user?.id ?? "");
  const { canManageChat } = useChatPermissions();
  const { isMobile } = useBreakpoint();

  const agentMembers = useMemo(() => members.filter((m) => m.subjectType === "AGENT"), [members]);

  const agentIds = useMemo(() => agentMembers.map((m) => m.subjectId), [agentMembers]);

  const { statsByAgentId, refresh: refreshAgentStats } = useChannelAgentContextBatch(
    channelId,
    agentIds,
  );

  const currentMember = useMemo(
    () => members.find((m) => m.subjectType === "USER" && m.userId === currentUserId),
    [members, currentUserId],
  );
  const isChannelAdmin = currentMember?.role === "OWNER" || currentMember?.role === "ADMIN";
  const canMutate = canManageChat || isChannelAdmin;

  const [expandedId, setExpandedId] = useState<string | null>(
    agentMembers.length === 1 ? agentMembers[0].subjectId : null,
  );

  const [position, setPosition] = useState({ top: 100, left: 100 });

  useEffect(() => {
    if (isMobile) return;
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const panelWidth = 380;
    let left = rect.left;
    if (left + panelWidth > window.innerWidth - 16) {
      left = window.innerWidth - panelWidth - 16;
    }
    if (left < 16) left = 16;
    setPosition({ top: rect.bottom + 6, left });
  }, [anchorRef, isMobile]);

  useEffect(() => {
    if (isMobile) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose, isMobile]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const body = (
    <>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Gauge size={16} className="text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Agent context</span>
          <span className="text-xs text-muted-foreground">({agentMembers.length})</span>
        </div>
        {!isMobile && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close"
            data-testid="chat-channel-agents-popover-close"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {agentMembers.length === 0 ? (
          <div className="py-8 px-4 text-center">
            <Gauge size={32} className="mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No active agent conversations</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Add an agent member to start tracking context here.
            </p>
          </div>
        ) : (
          agentMembers.map((m) => {
            const agent = agentsById[m.subjectId] ?? null;
            const name = agent?.name ?? m.displayName ?? `Agent ${m.subjectId.slice(-6)}`;
            const isOpen = expandedId === m.subjectId;
            return (
              <div
                key={m.subjectId}
                className="border-b border-border/50 last:border-b-0"
                data-testid={`chat-channel-agents-popover-row-${m.subjectId}`}
                data-state={isOpen ? "expanded" : "collapsed"}
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedId((prev) => (prev === m.subjectId ? null : m.subjectId))
                  }
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                  data-testid={`chat-channel-agents-popover-toggle-${m.subjectId}`}
                >
                  <AgentAvatar
                    avatarKey={agent?.avatarKey}
                    avatarEmoji={agent?.avatarEmoji}
                    agentName={name}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{name}</p>
                    <p className="text-xs text-muted-foreground truncate">Agent</p>
                  </div>
                  <CaretDown
                    size={14}
                    className={cn(
                      "text-muted-foreground transition-transform",
                      isOpen && "rotate-180",
                    )}
                  />
                </button>
                {isOpen && (
                  <AgentContextBar
                    channelId={channelId}
                    agentId={m.subjectId}
                    agentName={name}
                    variant="compact"
                    canMutate={canMutate}
                    stats={statsByAgentId[m.subjectId] ?? null}
                    onAfterAction={refreshAgentStats}
                  />
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <Drawer
        open
        onClose={onClose}
        side="right"
        className="w-[min(92vw,380px)]"
        ariaLabel="Agent context"
      >
        <div className="flex flex-col h-full">{body}</div>
      </Drawer>
    );
  }

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[100] w-[380px] max-h-[60vh] bg-card border border-border rounded-xl shadow-xl overflow-hidden flex flex-col"
      style={{ top: position.top, left: position.left }}
      data-testid="chat-channel-agents-popover"
    >
      {body}
    </div>,
    document.body,
  );
}
