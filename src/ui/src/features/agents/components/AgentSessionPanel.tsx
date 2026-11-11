import { useEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { CrepeEditor } from "@/components/editor/CrepeEditor";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { fetchMessages } from "@/features/agents/store/agentMessagesThunks";
import {
  selectMessagesForSession,
  selectThinkingByMessage,
} from "@/features/agents/store/agentMessagesSlice";
import { ThinkingPane } from "@/features/agents/components/ThinkingPane";
import { ToolActivityPane } from "@/features/agents/components/ToolActivityPane";
import { foldMessageTurns } from "@/features/agents/utils/messageTurns";
import { SUBJECT_TYPE, SubjectAvatar } from "@/components/subject";

const LIVE_REFRESH_MS = 2500;

interface AgentSessionPanelProps {
  open: boolean;
  onClose: () => void;
  sessionId: string | null;
  agentId: string;
  agentName: string;
  agentAvatarEmoji?: string | null;
  /** What the session worked on, for the header. */
  subject: string;
  /** Refreshes the transcript while the agent is still working. */
  live: boolean;
  status?: string;
}

/** A background agent session, read-only, for the person it worked for. */
export function AgentSessionPanel({
  open,
  onClose,
  sessionId,
  agentId,
  agentName,
  agentAvatarEmoji,
  subject,
  live,
  status,
}: AgentSessionPanelProps) {
  const dispatch = useAppDispatch();
  const messages = useAppSelector(selectMessagesForSession(sessionId));
  const thinkingByMessage = useAppSelector(selectThinkingByMessage);

  useEffect(() => {
    if (!open || !sessionId) return;
    void dispatch(fetchMessages({ sessionId }));
    if (!live) return;
    let inFlight = false;
    // One request at a time, and none while the tab is hidden.
    const timer = setInterval(() => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      void dispatch(fetchMessages({ sessionId })).finally(() => {
        inFlight = false;
      });
    }, LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [dispatch, open, sessionId, live]);

  const turns = useMemo(
    () => foldMessageTurns(messages, thinkingByMessage),
    [messages, thinkingByMessage],
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="right"
      width="w-full md:w-[520px]"
      showClose={false}
      ariaLabel={`${agentName} on ${subject}`}
    >
      <div className="flex h-full flex-col" data-testid="agent-session-panel">
        <div className="border-b border-border-strong px-4 py-3">
          <div className="flex items-center gap-2">
            <SubjectAvatar
              subject={{
                id: agentId,
                type: SUBJECT_TYPE.AGENT,
                name: agentName,
                avatarEmoji: agentAvatarEmoji ?? undefined,
              }}
              size="sm"
            />
            <span className="truncate text-sm font-medium text-foreground">{agentName}</span>
            {status && <span className="text-xs text-muted-foreground">{status}</span>}
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto min-h-11 min-w-11 shrink-0 md:min-h-0 md:min-w-0"
              onClick={onClose}
              aria-label="Close"
              data-testid="agent-session-panel-close"
            >
              <X size={16} weight="bold" />
            </Button>
          </div>
          <p className="mt-1 text-xs text-subtle-foreground">
            {subject}. The agent works with your permissions; only you can see this session.
          </p>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {!sessionId && (
            <p className="text-sm text-muted-foreground">The session has not started yet.</p>
          )}
          {turns.map((turn) => {
            if (turn.kind === "user") {
              return (
                <div key={turn.message.id} className="text-xs text-subtle-foreground">
                  {turn.message.content}
                </div>
              );
            }
            if (turn.kind === "tools") {
              return (
                <ToolActivityPane
                  key={turn.key}
                  steps={turn.steps}
                  live={false}
                  answerStarted={false}
                  testId="agent-session-tools"
                />
              );
            }
            if (turn.message.wasCancelled || turn.message.isInvalidated) {
              return (
                <p key={turn.message.id} className="text-xs italic text-muted-foreground">
                  {turn.message.wasCancelled
                    ? "The run was stopped here."
                    : "This reply was removed."}
                </p>
              );
            }
            return (
              <div key={turn.message.id} className="space-y-2">
                {turn.thinking.length > 0 && (
                  <ThinkingPane blocks={turn.thinking} live={false} answerStarted />
                )}
                {turn.message.content && (
                  <div className="overflow-hidden rounded-lg border border-border bg-muted">
                    <CrepeEditor
                      contentType={ContentType.AGENT}
                      contentId={turn.message.id}
                      value={turn.message.content}
                      readonly
                      compact
                      enableUpload={false}
                      className="chat-bubble-editor border-none bg-transparent"
                    />
                  </div>
                )}
              </div>
            );
          })}
          {live && <p className="text-xs text-muted-foreground">Working...</p>}
        </div>
      </div>
    </Drawer>
  );
}
