import { useState } from "react";
import { Robot } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { SUBJECT_TYPE, SubjectAvatar } from "@/components/subject";
import { AgentSessionPanel } from "@/features/agents/components/AgentSessionPanel";
import type { SerializedComment } from "@/features/comments/store/commentsSlice";

/** The author's name, or "<agent> for <person>" when an agent wrote it for them. */
export function CommentAuthor({ comment }: { comment: SerializedComment }) {
  const currentUserId = useAppSelector((state) => state.auth.user?.id);
  const [panelOpen, setPanelOpen] = useState(false);

  if (!comment.agentId) {
    return <span className="text-sm font-medium truncate">{comment.authorName}</span>;
  }
  const agentName = comment.agentName || "An agent";
  const canOpenSession = Boolean(comment.agentSessionId) && comment.authorId === currentUserId;
  return (
    <span
      className="inline-flex min-w-0 flex-wrap items-center gap-x-1"
      data-testid="comment-agent-author"
    >
      <Robot size={12} className="shrink-0 text-muted-foreground" />
      <span className="text-sm font-medium">{agentName}</span>
      <span className="text-sm text-muted-foreground">for {comment.authorName}</span>
      {canOpenSession && (
        <>
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            className="focus-ring inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded text-xs text-primary hover:underline md:min-h-0"
            data-testid="comment-view-session"
          >
            View session
          </button>
          <AgentSessionPanel
            open={panelOpen}
            onClose={() => setPanelOpen(false)}
            sessionId={comment.agentSessionId}
            agentId={comment.agentId}
            agentName={agentName}
            subject="Session"
            live={false}
          />
        </>
      )}
    </span>
  );
}

/** The agent's avatar on a comment it wrote, the author's otherwise. */
export function CommentAgentAvatar({ comment }: { comment: SerializedComment }) {
  return (
    <SubjectAvatar
      subject={{
        id: comment.agentId,
        type: SUBJECT_TYPE.AGENT,
        name: comment.agentName || "Agent",
      }}
      size="sm"
    />
  );
}
