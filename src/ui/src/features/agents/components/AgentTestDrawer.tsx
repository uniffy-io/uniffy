import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  ArrowSquareIn,
  ArrowsClockwise,
  ChatCircleDots,
  CircleNotch,
  Flask,
  PencilSimple,
  Stop,
  X,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { CrepeEditor } from "@/components/editor/CrepeEditor";
import { AgentTestComposer } from "@/features/agents/components/chat/AgentTestComposer";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { SessionKind } from "@uniffy/proto/agents/v1/sessions_pb";
import { createSession } from "@/features/agents/store/agentSessionsThunks";
import { PROMPT_BUILDER_PREFIX } from "@/features/agents/store/agentSessionsSlice";
import {
  selectIsStreaming,
  selectMessagesForSession,
  selectStreamingContent,
  selectStreamingThinking,
  selectStreamingToolCalls,
  selectThinkingByMessage,
} from "@/features/agents/store/agentMessagesSlice";
import {
  editAgentMessage,
  fetchMessages,
  rerunFromMessage,
  retryAgentMessage,
  streamSendMessage,
  cancelActiveRun,
} from "@/features/agents/store/agentMessagesThunks";
import type { SerializedMessage } from "@/features/agents/store/agentMessagesThunks";
import { updateAgent } from "@/features/agents/store/agentsThunks";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";
import { ThinkingPane } from "@/features/agents/components/ThinkingPane";
import { ToolActivityPane } from "@/features/agents/components/ToolActivityPane";
import { foldMessageTurns, streamingToolCallsToSteps } from "@/features/agents/utils/messageTurns";
import { SkillResponseActions } from "@/features/agents/components/skills/SkillResponseActions";

const TEST_SESSION_PREFIX = "[test] ";

function formatTime(ts?: { seconds: number; nanos: number }): string {
  if (!ts) return "";
  return new Date(ts.seconds * 1000).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function isOptimistic(message: SerializedMessage): boolean {
  return typeof message.id === "string" && message.id.startsWith("optimistic-");
}

function RemovedBubble({ align, label }: { align: "start" | "end"; label: string }) {
  return (
    <div className={cn("flex", align === "end" ? "justify-end" : "justify-start")}>
      <div className="max-w-[85%] rounded-2xl px-3.5 py-2 border border-dashed border-border text-xs italic text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function UserBubble({
  message,
  onEditAndRerun,
  disabled,
}: {
  message: SerializedMessage;
  onEditAndRerun?: (messageId: string, newContent: string) => void;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");

  if (message.isInvalidated) {
    return <RemovedBubble align="end" label="This message was removed" />;
  }

  if (editing) {
    return (
      <div className="flex justify-end">
        <div className="w-[85%] bg-card border border-border rounded-2xl rounded-br-sm p-2">
          <textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            rows={3}
            autoFocus
            className="w-full bg-transparent px-1 py-0.5 text-sm resize-none text-foreground focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (editValue.trim()) {
                  setEditing(false);
                  onEditAndRerun?.(message.id, editValue.trim());
                }
              } else if (e.key === "Escape") {
                setEditing(false);
              }
            }}
          />
          <div className="flex justify-end gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-6 px-2 text-xs"
              disabled={!editValue.trim()}
              onClick={() => {
                setEditing(false);
                onEditAndRerun?.(message.id, editValue.trim());
              }}
            >
              Save and rerun
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-end justify-end gap-1">
      {onEditAndRerun && (
        <button
          type="button"
          onClick={() => {
            setEditValue(message.content ?? "");
            setEditing(true);
          }}
          disabled={disabled || isOptimistic(message)}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0"
          title="Edit and rerun"
        >
          <PencilSimple size={13} />
        </button>
      )}
      <div className="max-w-[85%]">
        <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-3.5 py-2">
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </div>
        <p className="text-[10px] text-muted-foreground text-right mt-0.5 px-1">
          {formatTime(message.createdAt)}
          {message.editedAt && <span className="ml-1 italic">(edited)</span>}
        </p>
      </div>
    </div>
  );
}

function AssistantBubble({
  message,
  agentId,
  onApply,
  onRetry,
  disabled,
}: {
  message: SerializedMessage;
  agentId?: string;
  onApply?: (content: string) => void;
  onRetry?: (messageId: string) => void;
  disabled: boolean;
}) {
  if (message.isInvalidated) {
    return <RemovedBubble align="start" label="This reply was removed" />;
  }
  if (message.wasCancelled) {
    return <RemovedBubble align="start" label="Agent response cancelled" />;
  }

  return (
    <div className="group flex items-end justify-start gap-1">
      <div className="max-w-[85%]">
        <div className="border border-border rounded-lg overflow-hidden bg-muted">
          <CrepeEditor
            contentType={ContentType.AGENT}
            contentId={message.id}
            value={message.content ?? ""}
            readonly
            compact
            enableUpload={false}
            className="chat-bubble-editor border-none bg-transparent"
          />
          {onApply && message.content && (
            <button
              type="button"
              onClick={() => onApply(message.content ?? "")}
              className="mx-3 mb-2 flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
            >
              <ArrowSquareIn size={14} />
              Apply to Instructions
            </button>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5 px-1">
          {formatTime(message.createdAt)}
        </p>
        {agentId && !isOptimistic(message) && message.content && (
          <SkillResponseActions
            agentId={agentId}
            sessionId={message.sessionId}
            responseMessageId={message.id}
            attribution={message.skillInvocation}
          />
        )}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={() => onRetry(message.id)}
          disabled={disabled || isOptimistic(message)}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0"
          title="Retry from here"
        >
          <ArrowsClockwise size={13} />
        </button>
      )}
    </div>
  );
}

function WaitingDots() {
  return (
    <div className="flex justify-start">
      <div className="rounded-2xl rounded-bl-sm px-3.5 py-2.5 bg-muted">
        <div className="flex gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

export function AgentTestDrawer({
  agent,
  mode,
  open,
  onClose,
  canEdit,
}: {
  agent: SerializedAgent;
  mode: "test" | "builder";
  open: boolean;
  onClose: () => void;
  canEdit: boolean;
}) {
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const [session, setSession] = useState<{ key: string; id: string } | null>(null);
  const [chatKey, setChatKey] = useState(0);
  const sessionKey = `${organizationId}:${agent.id}:${mode}:${chatKey}`;
  const sessionId = open && session?.key === sessionKey ? session.id : null;
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = useAppSelector(selectMessagesForSession(sessionId));
  const thinkingByMessage = useAppSelector(selectThinkingByMessage);
  const streamingContent = useAppSelector(selectStreamingContent);
  const streamingThinking = useAppSelector(selectStreamingThinking);
  const streamingToolCalls = useAppSelector(selectStreamingToolCalls);
  const isStreaming = useAppSelector(selectIsStreaming);

  const isBuilder = mode === "builder";
  const handleClose = () => {
    setSession(null);
    onClose();
  };

  useEffect(() => {
    if (!open || !organizationId) return;
    let cancelled = false;
    const prefix = isBuilder ? PROMPT_BUILDER_PREFIX : TEST_SESSION_PREFIX;
    dispatch(
      createSession({
        agentId: agent.id,
        displayName: `${prefix}${agent.name}`,
        kind: SessionKind.GROUP,
        isTest: true,
      }),
    )
      .unwrap()
      .then((created) => {
        if (!cancelled) setSession({ key: sessionKey, id: created.id });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [agent.id, agent.name, organizationId, dispatch, open, sessionKey, isBuilder]);

  useEffect(() => {
    if (sessionId) dispatch(fetchMessages({ sessionId }));
  }, [sessionId, dispatch]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingContent, streamingThinking, streamingToolCalls.length]);

  const handleApply = useCallback(
    (content: string) => {
      if (!canEdit) return;
      dispatch(updateAgent({ agentId: agent.id, soulPrompt: content }));
    },
    [agent.id, canEdit, dispatch],
  );

  const handleEditAndRerun = useCallback(
    async (messageId: string, newContent: string) => {
      if (!sessionId) return;
      const result = await dispatch(editAgentMessage({ sessionId, messageId, newContent }));
      if (editAgentMessage.fulfilled.match(result)) {
        dispatch(rerunFromMessage({ sessionId, messageId }));
      }
    },
    [sessionId, dispatch],
  );

  const handleRetry = useCallback(
    async (messageId: string) => {
      if (!sessionId) return;
      const result = await dispatch(retryAgentMessage({ sessionId, messageId }));
      if (retryAgentMessage.fulfilled.match(result)) {
        dispatch(
          streamSendMessage({
            sessionId,
            content: result.payload.content,
            fileIds: result.payload.fileIds.length > 0 ? result.payload.fileIds : undefined,
          }),
        );
      }
    },
    [sessionId, dispatch],
  );

  const handleStop = useCallback(() => {
    dispatch(cancelActiveRun());
  }, [dispatch]);

  const turns = useMemo(
    () => foldMessageTurns(messages, thinkingByMessage),
    [messages, thinkingByMessage],
  );
  const streamingSteps = useMemo(
    () => streamingToolCallsToSteps(streamingToolCalls),
    [streamingToolCalls],
  );

  const hasMessages = messages.length > 0 || isStreaming;
  const streamingToolsLive = streamingToolCalls.some((tc) => tc.result === undefined);

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      side="right"
      width="w-[440px]"
      className="max-w-[90vw]"
      showClose={false}
      ariaLabel={isBuilder ? "Prompt Builder" : `Test ${agent.name}`}
    >
      <div
        className="flex flex-col h-full min-h-0"
        data-testid="agent-test-drawer"
        data-mode={mode}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {isBuilder ? (
              <ChatCircleDots size={18} weight="duotone" className="text-primary shrink-0" />
            ) : (
              <Flask size={18} weight="duotone" className="text-primary shrink-0" />
            )}
            <span className="text-sm font-semibold text-foreground truncate">
              {isBuilder ? "Prompt Builder" : `Test ${agent.name}`}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {isStreaming && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleStop}
                className="h-7 gap-1 px-2 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                title="Stop the agent"
              >
                <Stop size={13} weight="fill" />
                <span className="text-xs">Stop</span>
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSession(null);
                setChatKey((k) => k + 1);
              }}
              disabled={isStreaming || !sessionId}
              title="New conversation"
              className="h-7 w-7"
            >
              <ArrowCounterClockwise size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              className="h-7 w-7"
              aria-label="Close test drawer"
            >
              <X size={14} />
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {!sessionId ? (
            <div className="flex items-center justify-center h-full">
              <CircleNotch size={24} className="animate-spin text-muted-foreground" />
            </div>
          ) : !hasMessages ? (
            <div className="flex flex-col items-center justify-center h-full px-6 py-8 text-center">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                {isBuilder ? (
                  <PencilSimple size={24} weight="duotone" className="text-primary" />
                ) : (
                  <Flask size={24} weight="duotone" className="text-primary" />
                )}
              </div>
              <p className="text-sm font-medium text-foreground mb-1">
                {isBuilder ? "AI Prompt Builder" : "Test this agent"}
              </p>
              <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
                {isBuilder
                  ? 'Describe what your agent should do and the AI will generate system instructions. Click "Apply" on any response to set it as the agent\'s instructions.'
                  : "Send messages to try the agent's instructions, tools, and reasoning. Edit a message or retry a reply to iterate quickly."}
              </p>
            </div>
          ) : (
            <div className="p-3 space-y-3">
              {turns.map((turn) => {
                if (turn.kind === "user") {
                  return (
                    <UserBubble
                      key={turn.message.id}
                      message={turn.message}
                      onEditAndRerun={isBuilder ? undefined : handleEditAndRerun}
                      disabled={isStreaming}
                    />
                  );
                }
                if (turn.kind === "tools") {
                  return (
                    <ToolActivityPane
                      key={turn.key}
                      steps={turn.steps}
                      live={false}
                      answerStarted
                    />
                  );
                }
                return (
                  <div key={turn.message.id} className="space-y-1.5">
                    {turn.thinking.length > 0 && (
                      <ThinkingPane blocks={turn.thinking} live={false} answerStarted />
                    )}
                    <AssistantBubble
                      message={turn.message}
                      agentId={isBuilder ? undefined : agent.id}
                      onApply={isBuilder && canEdit ? handleApply : undefined}
                      onRetry={isBuilder ? undefined : handleRetry}
                      disabled={isStreaming}
                    />
                  </div>
                );
              })}

              {isStreaming &&
                !streamingContent &&
                streamingThinking.length === 0 &&
                streamingToolCalls.length === 0 && <WaitingDots />}

              {streamingThinking.length > 0 && (
                <ThinkingPane
                  blocks={streamingThinking}
                  live={isStreaming && streamingThinking.some((b) => !b.done)}
                  answerStarted={!!streamingContent || streamingToolCalls.length > 0}
                />
              )}

              {streamingSteps.length > 0 && (
                <ToolActivityPane
                  steps={streamingSteps}
                  live={streamingToolsLive}
                  answerStarted={!!streamingContent}
                  onStop={handleStop}
                />
              )}

              {streamingContent && (
                <div className="flex justify-start">
                  <div className="max-w-[85%]">
                    <div className="rounded-2xl rounded-bl-sm px-3.5 py-2 bg-muted">
                      <p className="text-sm text-foreground whitespace-pre-wrap">
                        {streamingContent}
                      </p>
                      <span className="inline-block w-1.5 h-4 bg-foreground/40 animate-pulse ml-0.5" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <AgentTestComposer
          key={`${organizationId}:${agent.id}:${mode}:${sessionId}`}
          agentId={agent.id}
          sessionId={sessionId}
          isBuilder={isBuilder}
          isStreaming={isStreaming}
        />
      </div>
    </Drawer>
  );
}
