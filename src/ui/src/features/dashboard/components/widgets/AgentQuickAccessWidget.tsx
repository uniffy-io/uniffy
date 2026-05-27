import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Brain, ArrowRight, Plus } from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { WidgetCard, WidgetSkeleton } from '@/features/dashboard/components/widgets/WidgetCard';
import { formatRelativeTime } from '@/shared/utils/dateFormatting';
import { isPromptBuilderSession } from '@/features/agents/store/agentSessionsSlice';
import type { SerializedSession } from '@/features/agents/store/agentSessionsThunks';

function sessionTimestamp(ts: { seconds: number; nanos: number } | undefined): string {
  if (!ts) return new Date(0).toISOString();
  return new Date(ts.seconds * 1000).toISOString();
}

export function AgentQuickAccessWidget() {
  const navigate = useNavigate();
  const sessions = useAppSelector((state) => state.agentSessions?.sessions ?? {});
  const agents = useAppSelector((state) => state.agents?.agents ?? {});
  const isLoading = useAppSelector((state) => state.agentSessions?.loading ?? false);

  const recentSessions = useMemo(() => {
    return Object.values(sessions)
      .filter((s: SerializedSession) => !s.isArchived && !isPromptBuilderSession(s))
      .sort((a: SerializedSession, b: SerializedSession) => {
        const aTime = a.updatedAt?.seconds ?? 0;
        const bTime = b.updatedAt?.seconds ?? 0;
        return bTime - aTime;
      })
      .slice(0, 3);
  }, [sessions]);

  if (recentSessions.length === 0 && !isLoading) return null;

  return (
    <WidgetCard
      title="Agent Sessions"
      icon={Brain}
      colSpan={2}
      priority={3}
      action={
        <button
          onClick={() => navigate('/agents')}
          className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
        >
          <Plus size={12} />
          New
        </button>
      }
      footer={
        <Link
          to="/agents"
          className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
        >
          View all sessions
          <ArrowRight size={12} />
        </Link>
      }
    >
      {isLoading && Object.keys(sessions).length === 0 ? (
        <WidgetSkeleton rows={3} />
      ) : (
        <div className="space-y-0.5">
          {recentSessions.map((session: SerializedSession) => {
            const agent = agents[session.agentId];
            return (
              <Link
                key={session.id}
                to={`/agents?session=${session.id}`}
                className={cn(
                  'group flex items-center gap-3 rounded-lg p-2 -mx-2 transition-colors',
                  'hover:bg-muted/50',
                )}
              >
                <div className="w-8 h-8 rounded-md bg-cyan-500/10 flex items-center justify-center shrink-0">
                  <Brain size={16} weight="duotone" className="text-cyan-600 dark:text-cyan-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                    {session.displayName || agent?.name || 'Agent Session'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {session.messageCount} messages
                    {session.lastModelUsed && ` - ${session.lastModelUsed}`}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {formatRelativeTime(sessionTimestamp(session.updatedAt))}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </WidgetCard>
  );
}
