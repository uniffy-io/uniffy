import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Brain, ArrowRight, Plus } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { WidgetCard, WidgetSkeleton } from "@/features/dashboard/components/widgets/WidgetCard";
import { selectAllAgents, selectAgentsLoading } from "@/features/agents/store/agentsSlice";
import { fetchAgents } from "@/features/agents/store/agentsThunks";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";
import { AgentAvatar } from "@/features/agents/components/AgentAvatar";
import { createAgentChat } from "@/features/chat/store/chatThunks";

export function AgentQuickAccessWidget() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const agentsMap = useAppSelector(selectAllAgents);
  const isLoading = useAppSelector(selectAgentsLoading);
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    if (Object.keys(agentsMap).length === 0) {
      dispatch(fetchAgents());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time cold load
  }, [dispatch]);

  const topAgents = useMemo(() => {
    return Object.values(agentsMap)
      .sort((a: SerializedAgent, b: SerializedAgent) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        const aTime = a.updatedAt?.seconds ?? 0;
        const bTime = b.updatedAt?.seconds ?? 0;
        return bTime - aTime;
      })
      .slice(0, 3);
  }, [agentsMap]);

  const handleOpenChat = async (agentId: string) => {
    if (openingId) return;
    setOpeningId(agentId);
    try {
      const channel = await dispatch(createAgentChat({ agentId })).unwrap();
      navigate(`/chat/${channel.id}`);
    } finally {
      setOpeningId(null);
    }
  };

  if (topAgents.length === 0 && !isLoading) return null;

  return (
    <WidgetCard
      title="Agents"
      icon={Brain}
      colSpan={2}
      priority={3}
      action={
        <button
          onClick={() => navigate("/chat")}
          className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
        >
          <Plus size={12} />
          New
        </button>
      }
      footer={
        <Link
          to="/chat"
          className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
        >
          Open chat
          <ArrowRight size={12} />
        </Link>
      }
    >
      {isLoading && topAgents.length === 0 ? (
        <WidgetSkeleton rows={3} />
      ) : (
        <div className="space-y-0.5">
          {topAgents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => handleOpenChat(agent.id)}
              disabled={openingId !== null}
              className={cn(
                "group flex items-center gap-3 w-full text-left rounded-lg p-2 -mx-2 transition-colors",
                "hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              <AgentAvatar
                avatarKey={agent.avatarKey}
                avatarEmoji={agent.avatarEmoji}
                agentName={agent.name}
                size="sm"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                  {agent.name}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {agent.isDefault ? "Default agent" : agent.primaryModel || "Agent"}
                </p>
              </div>
              <span className="text-xs text-muted-foreground flex-shrink-0">
                {openingId === agent.id ? "Opening..." : "Chat"}
              </span>
            </button>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}
