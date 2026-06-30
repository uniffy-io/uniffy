import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { PaperPlaneRight, Paperclip, FileText, Wrench, X, CircleNotch, GearSix, Warning, Check, Database, ArrowsClockwise, Code, Eye, PencilSimple, Stop, Trash, Lightning, ThumbsUp, ThumbsDown } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { loadPanelLayout, savePanelLayout } from "@/shared/utils/panelStorage";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UniffyLogo } from "@/components/ui/uniffy-logo";
import { CrepeEditor } from "@/components/editor/CrepeEditor";
import { uploadImage } from "@/components/editor/utils/imageUploader";
import { MentionChipCompact } from "@/components/mention";
import { getMentionUrl } from "@/components/mention/mentionStateEmitter";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { SessionKind } from "@uniffy/proto/agents/v1/sessions_pb";
import { parseUrn, urnToPath } from "@/shared/utils/urn";
import { navigateTo, openInNewTab } from "@/shared/utils/navigation";
import { useTextareaMention } from "@/features/agents/hooks/useTextareaMention";
import { ChatMentionPopup } from "@/features/agents/components/chat/ChatMentionPopup";
import { useTextareaSlash } from "@/features/agents/hooks/useTextareaSlash";
import { SkillSlashPopup } from "@/features/agents/components/chat/SkillSlashPopup";
import { fetchRunnableSkills, type SerializedRunnableSkill } from "@/features/agents/store/agentRunnableSkillsThunks";
import { selectRunnableSkillsForAgent } from "@/features/agents/store/agentRunnableSkillsSlice";
import { ProposedSkillDraftCard } from "@/features/agents/components/skills/ProposedSkillDraftCard";
import { selectSessionDrafts } from "@/features/agents/store/agentSkillDraftsSlice";
import type { SerializedSkillDraft } from "@/features/agents/store/agentSkillDraftsThunks";
import {
    selectChatMessage,
    selectSidebarContent,
    setChatMessage,
    setSidebarContent,
} from "@/features/agents/store/agentsUiSlice";
import { selectAllAgents } from "@/features/agents/store/agentsSlice";
import { fetchAgents } from "@/features/agents/store/agentsThunks";
import { selectActiveSessionId, selectActiveSession, selectContextStats } from "@/features/agents/store/agentSessionsSlice";
import { fetchSessions, createSession, fetchSessionContextStats, compactSession } from "@/features/agents/store/agentSessionsThunks";
import {
    selectMessagesForSession,
    selectStreamingContent,
    selectStreamingToolCalls,
    selectIsStreaming,
    selectActiveRunId,
    selectPendingConfirmation,
    cacheFileMetadata,
} from "@/features/agents/store/agentMessagesSlice";
import { useAgentRunStream } from "@/features/agents/hooks/useAgentRunStream";
import type { FileMetadata } from "@/features/agents/store/agentMessagesSlice";
import {
    fetchMessages,
    streamSendMessage,
    respondToConfirmation,
    cancelActiveRun,
    editAgentMessage,
    deleteAgentMessage,
    retryAgentMessage,
    submitMessageFeedback,
    rerunFromMessage,
    MessageRole,
} from "@/features/agents/store/agentMessagesThunks";
import type { SerializedMessage } from "@/features/agents/store/agentMessagesThunks";
import { selectAvailableModels } from "@/features/agents/store/agentProvidersSlice";
import { fetchAvailableModels } from "@/features/agents/store/agentProvidersThunks";
import { ChatSessionSidebar } from "@/features/agents/components/chat/ChatSessionSidebar";
import { AgentAvatar } from "@/features/agents/components/AgentAvatar";
import { TOOL_SECTIONS } from "@/features/agents/config/toolCatalog";


const TOOL_DISPLAY_NAMES: Record<string, string> = {};
for (const section of TOOL_SECTIONS) {
    for (const group of section.groups) {
        for (const tool of group.tools) {
            TOOL_DISPLAY_NAMES[tool.name] = tool.displayName;
        }
    }
}

function getToolActionLabel(toolName: string): string {
    const display = TOOL_DISPLAY_NAMES[toolName];
    if (display) return display;
    const parts = toolName.split(".");
    const action = parts[parts.length - 1];
    return action
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

function humanizeEnumValue(value: string): string {
    const parts = value.split("_");
    const meaningful = (parts.length > 1 && ["status", "priority"].includes(parts[0]))
        ? parts.slice(1)
        : parts;
    return meaningful.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function parseFieldLine(line: string): Array<{ key: string; value: string }> {
    return line.split("|").map((segment) => {
        const colonIdx = segment.indexOf(":");
        if (colonIdx === -1) return { key: "", value: segment.trim() };
        return {
            key: segment.slice(0, colonIdx).trim(),
            value: segment.slice(colonIdx + 1).trim(),
        };
    }).filter((f) => f.key || f.value);
}

function formatTime(ts?: { seconds: number; nanos: number }): string {
    if (!ts) return "";
    return new Date(ts.seconds * 1000).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
    });
}

function tsSeconds(ts?: { seconds: number; nanos: number }): number {
    return ts?.seconds ?? 0;
}

function formatTokenCount(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
    return String(tokens);
}

const MENTION_RE = /\[\[\[([^|]+)\|([^\]]+)\]\]\]/g;

function preprocessMentions(content: string): string {
    return content.replace(MENTION_RE, "[@$1]($2)");
}

function MarkdownLink({ href, children }: { href?: string; children?: React.ReactNode }) {
    if (href?.startsWith("urn:uniffy:content:")) {
        const label = String(children ?? "").replace(/^@/, "");
        const parsed = parseUrn(href);

        const handleClick = (e?: React.MouseEvent) => {
            if (!parsed.isValid) return;
            const resolved = getMentionUrl(href);
            const path = resolved || urnToPath(href);
            if (!path || path === "#") return;
            if (e?.metaKey || e?.ctrlKey) {
                openInNewTab(path);
            } else {
                navigateTo(path);
            }
        };

        return <MentionChipCompact urn={href} label={label} onClick={handleClick} />;
    }
    return <a href={href}>{children}</a>;
}

const markdownComponents = { a: MarkdownLink };

function ChatMessageContent({ content }: { content: string }) {
    const parts = useMemo(() => {
        const segments: React.ReactNode[] = [];
        const regex = /\[\[\[([^|]+)\|([^\]]+)\]\]\]/g;
        let lastIndex = 0;
        let match;
        let key = 0;

        while ((match = regex.exec(content)) !== null) {
            if (match.index > lastIndex) {
                segments.push(content.slice(lastIndex, match.index));
            }
            const label = match[1];
            const urn = match[2];
            segments.push(
                <MentionChipCompact
                    key={key++}
                    urn={urn}
                    label={label}
                    onClick={(e?: React.MouseEvent) => {
                        const path = urnToPath(urn);
                        if (path === "#") return;
                        if (e?.metaKey || e?.ctrlKey) {
                            openInNewTab(path);
                        } else {
                            navigateTo(path);
                        }
                    }}
                />
            );
            lastIndex = match.index + match[0].length;
        }
        if (lastIndex < content.length) {
            segments.push(content.slice(lastIndex));
        }
        return segments;
    }, [content]);

    return <p className="text-sm whitespace-pre-wrap">{parts}</p>;
}

const FILE_TEXT_BLOCK_RE = /\n?--- File: .+? ---\n[\s\S]*?--- End of .+? ---/g;

function UserBubble({ message }: { message: SerializedMessage }) {
    const rawContent = message.content ?? "";
    const content = rawContent.replace(FILE_TEXT_BLOCK_RE, "").trim();
    const hasFileMentions = /\[\[\[[^|]+\|urn:uniffy:content:FILE:[^\]]+\]\]\]/.test(content);
    const hasInlineImages = /!\[.*?\]\(\/api\/files\//.test(content);
    const useRichEditor = hasFileMentions || hasInlineImages;
    const isInvalidated = !!message.isInvalidated;
    const wasEdited = !!message.editedAt;

    if (isInvalidated) {
        return <RemovedBubble align="end" label="This user message was removed" timestamp={message.createdAt} />;
    }

    return (
        <div className="group flex flex-col items-end">
            <div className="flex items-end gap-1 w-full justify-end">
                <MessageActions message={message} />
                <div className="max-w-[70%] bg-chat-user text-chat-user-foreground rounded-2xl rounded-br-sm px-4 py-2">
                    {useRichEditor ? (
                        <CrepeEditor
                            contentType={ContentType.NOTE}
                            contentId={message.id}
                            value={content}
                            readonly
                            enableUpload={false}
                            compact
                            autoEmbedMedia
                            className="border-none bg-transparent chat-bubble-editor chat-bubble-user"
                        />
                    ) : (
                        <ChatMessageContent content={content} />
                    )}
                </div>
            </div>
            <span className="text-xs text-muted-foreground text-right mt-1 flex items-center gap-1 justify-end">
                {message.invokedSkillName && (
                    <>
                        <span className="inline-flex items-center gap-0.5 text-primary">
                            <Lightning size={11} weight="fill" />
                            {message.invokedSkillName}
                        </span>
                        <span aria-hidden>·</span>
                    </>
                )}
                {formatTime(message.createdAt)}
                {wasEdited && <span className="ml-1 italic">(edited)</span>}
            </span>
        </div>
    );
}

function RemovedBubble({
    align,
    label,
    timestamp,
}: {
    align: "start" | "end";
    label: string;
    timestamp?: { seconds: number; nanos: number };
}) {
    return (
        <div className={cn("group flex flex-col", align === "end" ? "items-end" : "items-start")}>
            <div
                className={cn(
                    "max-w-[70%] rounded-2xl px-4 py-2 border border-dashed border-border bg-transparent text-xs italic text-muted-foreground",
                    align === "end" ? "rounded-br-sm" : "rounded-bl-sm",
                )}
            >
                {label}
            </div>
            <span className={cn("text-xs text-muted-foreground mt-1", align === "end" ? "text-right" : "text-left")}>
                {formatTime(timestamp)}
            </span>
        </div>
    );
}

function AssistantBubble({ message }: { message: SerializedMessage }) {
    const isThinking = message.isThinking;
    const isInvalidated = !!message.isInvalidated;
    const wasCancelled = !!message.wasCancelled;

    if (isInvalidated) {
        return <RemovedBubble align="start" label="This agent message was removed" timestamp={message.createdAt} />;
    }
    if (wasCancelled) {
        return <RemovedBubble align="start" label="Agent response cancelled" timestamp={message.createdAt} />;
    }

    return (
        <div className="group flex flex-col items-start">
            <div className="flex items-end gap-1 w-full justify-start">
                <div
                    className={cn(
                        "max-w-[70%] rounded-2xl rounded-bl-sm",
                        isThinking
                            ? "bg-muted/50 border border-dashed border-border px-4 py-2"
                            : "bg-muted overflow-hidden",
                    )}
                >
                    {isThinking ? (
                        <p className="text-sm whitespace-pre-wrap italic text-muted-foreground">
                            Thinking... {message.content ?? ""}
                        </p>
                    ) : (
                        <CrepeEditor
                            contentType={ContentType.NOTE}
                            contentId={message.id}
                            value={message.content ?? ""}
                            readonly
                            enableUpload={false}
                            compact
                            autoEmbedMedia
                            className="border-none bg-transparent chat-bubble-editor"
                        />
                    )}
                </div>
                <MessageActions message={message} />
            </div>
            <span className="text-xs text-muted-foreground mt-1">
                {formatTime(message.createdAt)}
            </span>
        </div>
    );
}

function MessageActions({ message }: { message: SerializedMessage }) {
    const dispatch = useAppDispatch();
    const isStreaming = useAppSelector(selectIsStreaming);
    const isUser = message.role === MessageRole.USER;
    const isInvalidated = !!message.isInvalidated;
    const isOptimistic = typeof message.id === 'string' && message.id.startsWith('optimistic-');
    const [editing, setEditing] = useState(false);
    const [editValue, setEditValue] = useState("");

    if (isInvalidated) return null;

    const handleEditOpen = () => {
        setEditValue(message.content ?? "");
        setEditing(true);
    };
    const handleEditSubmit = async () => {
        if (!editValue.trim()) return;
        const editResult = await dispatch(
            editAgentMessage({
                sessionId: message.sessionId,
                messageId: message.id,
                newContent: editValue.trim(),
            }),
        );
        setEditing(false);
        if (editAgentMessage.fulfilled.match(editResult)) {
            dispatch(rerunFromMessage({
                sessionId: message.sessionId,
                messageId: message.id,
            }));
        }
    };
    const handleDelete = () => {
        dispatch(deleteAgentMessage({ sessionId: message.sessionId, messageId: message.id }));
    };
    const handleRetry = async () => {
        const result = await dispatch(
            retryAgentMessage({ sessionId: message.sessionId, messageId: message.id }),
        );
        if (retryAgentMessage.fulfilled.match(result)) {
            dispatch(setChatMessage(result.payload.content));
        }
    };
    const handleFeedback = (rating: "up" | "down") => {
        // Clicking the active thumb clears it; otherwise sets the new rating.
        const next = message.feedbackRating === rating ? "" : rating;
        dispatch(
            submitMessageFeedback({
                sessionId: message.sessionId,
                messageId: message.id,
                rating: next,
            }),
        );
    };

    if (editing) {
        return (
            <EditPopover
                value={editValue}
                onChange={setEditValue}
                onSubmit={handleEditSubmit}
                onCancel={() => setEditing(false)}
            />
        );
    }

    const hasRating = !isUser && !!message.feedbackRating;

    return (
        <div
            className={cn(
                "flex items-center gap-0.5 transition-opacity",
                hasRating ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                isUser ? "order-first" : "",
            )}
        >
            {isUser && (
                <button
                    type="button"
                    onClick={handleEditOpen}
                    disabled={isStreaming || isOptimistic}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
                    title="Edit message"
                >
                    <PencilSimple size={14} />
                </button>
            )}
            <button
                type="button"
                onClick={handleRetry}
                disabled={isStreaming || isOptimistic}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
                title="Retry from here"
            >
                <ArrowsClockwise size={14} />
            </button>
            {!isUser && (
                <>
                    <button
                        type="button"
                        onClick={() => handleFeedback("up")}
                        disabled={isStreaming || isOptimistic}
                        className={cn(
                            "p-1.5 rounded-md hover:bg-muted disabled:opacity-50",
                            message.feedbackRating === "up"
                                ? "text-green-600 dark:text-green-400"
                                : "text-muted-foreground hover:text-foreground",
                        )}
                        title="Good response"
                    >
                        <ThumbsUp size={14} weight={message.feedbackRating === "up" ? "fill" : "regular"} />
                    </button>
                    <button
                        type="button"
                        onClick={() => handleFeedback("down")}
                        disabled={isStreaming || isOptimistic}
                        className={cn(
                            "p-1.5 rounded-md hover:bg-muted disabled:opacity-50",
                            message.feedbackRating === "down"
                                ? "text-red-500"
                                : "text-muted-foreground hover:text-foreground",
                        )}
                        title="Bad response"
                    >
                        <ThumbsDown size={14} weight={message.feedbackRating === "down" ? "fill" : "regular"} />
                    </button>
                </>
            )}
            {isUser && (
                <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isStreaming || isOptimistic}
                    className="p-1.5 rounded-md text-muted-foreground hover-destructive disabled:opacity-50"
                    title="Delete message"
                >
                    <Trash size={14} />
                </button>
            )}
        </div>
    );
}

function EditPopover({
    value,
    onChange,
    onSubmit,
    onCancel,
}: {
    value: string;
    onChange: (v: string) => void;
    onSubmit: () => void;
    onCancel: () => void;
}) {
    return (
        <div className="bg-card border border-border rounded-2xl shadow-lg p-3 w-[420px] max-w-[80vw]">
            <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                rows={3}
                autoFocus
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        onSubmit();
                    } else if (e.key === "Escape") {
                        onCancel();
                    }
                }}
            />
            <div className="flex justify-end gap-2 mt-2">
                <Button variant="ghost" size="sm" onClick={onCancel}>
                    Cancel
                </Button>
                <Button size="sm" onClick={onSubmit} disabled={!value.trim()}>
                    Save
                </Button>
            </div>
        </div>
    );
}

function ToolResultHuman({ result }: { result: string }) {
    const lines = result.split("\n").filter((l) => l.trim());
    return (
        <div className="space-y-1">
            {lines.map((line, idx) => {
                if (idx === 0) {
                    return (
                        <div key={idx} className="text-sm text-foreground">
                            <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                {preprocessMentions(line)}
                            </Markdown>
                        </div>
                    );
                }
                if (line.includes("|") && line.includes(":")) {
                    const fields = parseFieldLine(line);
                    return (
                        <div key={idx} className="flex flex-wrap gap-2">
                            {fields.map((f, fi) => (
                                <span key={fi} className="inline-flex items-center gap-1 text-xs">
                                    <span className="text-muted-foreground">{f.key}:</span>
                                    <span className="text-foreground font-medium">
                                        {humanizeEnumValue(f.value)}
                                    </span>
                                </span>
                            ))}
                        </div>
                    );
                }
                const colonIdx = line.indexOf(":");
                if (colonIdx > 0 && colonIdx < 30) {
                    const key = line.slice(0, colonIdx).trim();
                    const value = line.slice(colonIdx + 1).trim();
                    const hasMentions = /\[\[\[([^|]+)\|([^\]]+)\]\]\]/.test(value);
                    return (
                        <div key={idx} className="text-xs">
                            <span className="text-muted-foreground">{key}: </span>
                            {hasMentions ? (
                                <span className="text-foreground">
                                    <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                        {preprocessMentions(value)}
                                    </Markdown>
                                </span>
                            ) : (
                                <span className="text-foreground">{value}</span>
                            )}
                        </div>
                    );
                }
                return (
                    <div key={idx} className="text-xs text-foreground">
                        <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                            {preprocessMentions(line)}
                        </Markdown>
                    </div>
                );
            })}
        </div>
    );
}

function ToolCallGroup({ messages }: { messages: SerializedMessage[] }) {
    const [expanded, setExpanded] = useState(false);
    const [viewMode, setViewMode] = useState<"human" | "technical">("human");

    if (messages.length === 0) return null;

    const toolNames = [...new Set(messages.map((m) => m.toolName).filter(Boolean))];
    const label = toolNames.length === 1
        ? getToolActionLabel(toolNames[0]!)
        : `${messages.length} actions`;

    return (
        <div className="flex flex-col items-start">
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className={cn(
                    "flex items-center gap-2.5 px-4 py-2.5 rounded-2xl rounded-bl-sm",
                    "bg-muted/60 hover:bg-muted/80 transition-colors cursor-pointer text-left",
                )}
            >
                <Wrench size={16} weight="duotone" className="text-muted-foreground shrink-0" />
                <span className="text-sm text-foreground">
                    {label}
                </span>
                {messages.length > 1 && (
                    <Badge variant="secondary" className="text-xs px-1.5 py-0">
                        {messages.length}
                    </Badge>
                )}
                <span className={cn(
                    "text-xs text-muted-foreground transition-transform",
                    expanded && "rotate-180",
                )}>
                    &#x25BE;
                </span>
            </button>
            {expanded && (
                <div className="mt-1.5 ml-4 max-w-[70%]">
                    <div className="flex items-center justify-end mb-1">
                        <button
                            type="button"
                            onClick={() => setViewMode((v) => v === "human" ? "technical" : "human")}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            title={viewMode === "human" ? "Show technical details" : "Show summary"}
                        >
                            {viewMode === "human" ? (
                                <><Code size={13} /> Technical</>
                            ) : (
                                <><Eye size={13} /> Summary</>
                            )}
                        </button>
                    </div>
                    <div className="space-y-1.5">
                        {messages.map((msg) => (
                            <div key={msg.id} className="bg-card border border-border rounded-lg overflow-hidden text-xs">
                                <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 border-b border-border">
                                    <span className="font-medium text-foreground">
                                        {getToolActionLabel(msg.toolName ?? "")}
                                    </span>
                                </div>
                                <div className="px-3 py-1.5">
                                    {viewMode === "technical" ? (
                                        <div className="space-y-1">
                                            {msg.toolArgsJson && (
                                                <pre className="font-mono bg-muted/30 rounded p-1.5 overflow-x-auto text-foreground">
                                                    {msg.toolArgsJson}
                                                </pre>
                                            )}
                                            {msg.toolResult && (
                                                <pre className="font-mono bg-muted/30 rounded p-1.5 overflow-x-auto text-foreground">
                                                    {msg.toolResult}
                                                </pre>
                                            )}
                                        </div>
                                    ) : (
                                        msg.toolResult
                                            ? <ToolResultHuman result={msg.toolResult} />
                                            : <span className="text-muted-foreground italic">No result</span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function ThinkingIndicator({ agent }: {
    agent?: { avatarKey?: string; avatarEmoji?: string; name: string } | null;
}) {
    return (
        <div className="flex items-end gap-2 bubble-enter">
            {agent && (
                <AgentAvatar
                    avatarKey={agent.avatarKey}
                    avatarEmoji={agent.avatarEmoji}
                    agentName={agent.name}
                    size="sm"
                />
            )}
            <div className="rounded-2xl rounded-bl-sm px-4 py-3 bg-muted">
                <div className="flex items-center gap-1">
                    <span className="thinking-dot block w-2 h-2 rounded-full bg-foreground/50" />
                    <span className="thinking-dot block w-2 h-2 rounded-full bg-foreground/50" />
                    <span className="thinking-dot block w-2 h-2 rounded-full bg-foreground/50" />
                </div>
            </div>
        </div>
    );
}

function StreamingBubble({ content }: { content: string }) {
    if (!content) return null;
    return (
        <div className="flex flex-col items-start bubble-enter">
            <div className="max-w-[70%] rounded-2xl rounded-bl-sm px-4 py-2 bg-muted">
                <div className="prose prose-sm dark:prose-invert max-w-none text-foreground prose-p:my-1 prose-pre:my-2 prose-ul:my-1 prose-ol:my-1 prose-headings:my-2 prose-code:text-primary prose-code:before:content-none prose-code:after:content-none">
                    <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {preprocessMentions(content)}
                    </Markdown>
                </div>
                <span className="streaming-cursor inline-block w-[2px] h-[1.1em] bg-foreground/70 rounded-full ml-0.5 align-text-bottom" />
            </div>
        </div>
    );
}

function StreamingToolCards({ toolCalls }: { toolCalls: Array<{ toolCallId: string; toolName: string; toolArgsJson: string; result?: string; success?: boolean }> }) {
    if (toolCalls.length === 0) return null;

    const completed = toolCalls.filter((tc) => tc.result !== undefined);
    const active = toolCalls.find((tc) => tc.result === undefined);
    const isWorking = !!active;

    return (
        <div className="flex flex-col items-start bubble-enter">
            <div className="flex items-center gap-2.5 px-4 py-2.5 bg-muted/60 rounded-2xl rounded-bl-sm">
                <Wrench
                    size={18}
                    weight="duotone"
                    className={cn(
                        "text-primary shrink-0",
                        isWorking && "wrench-active",
                    )}
                />
                <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-foreground">
                        {isWorking
                            ? getToolActionLabel(active.toolName)
                            : "Done"}
                    </span>
                    {toolCalls.length > 1 && (
                        <span className="text-xs text-muted-foreground">
                            {completed.length} of {toolCalls.length} actions completed
                        </span>
                    )}
                </div>
                {isWorking && (
                    <CircleNotch size={14} className="animate-spin text-muted-foreground ml-1" />
                )}
            </div>
        </div>
    );
}

function ConfirmationDialog({
    toolName,
    toolArgsJson,
    onApprove,
    onReject,
}: {
    toolName: string;
    toolArgsJson: string;
    description: string;
    onApprove: () => void;
    onReject: () => void;
}) {
    const [showDetails, setShowDetails] = useState(false);
    const friendlyName = getToolActionLabel(toolName);

    return (
        <div className="flex flex-col items-start bubble-enter">
            <div className="max-w-[70%] bg-card border-2 border-yellow-500/50 rounded-2xl rounded-bl-sm overflow-hidden">
                <div className="px-4 py-3 space-y-3">
                    <div className="flex items-center gap-2.5">
                        <Warning size={20} weight="fill" className="text-yellow-500 shrink-0" />
                        <div>
                            <p className="text-sm font-medium text-foreground">
                                The agent wants to {friendlyName.toLowerCase()}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                This action cannot be undone. Do you want to proceed?
                            </p>
                        </div>
                    </div>
                    {toolArgsJson && toolArgsJson !== "{}" && (
                        <button
                            type="button"
                            onClick={() => setShowDetails((v) => !v)}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                        >
                            <Code size={12} />
                            {showDetails ? "Hide details" : "Show details"}
                        </button>
                    )}
                    {showDetails && toolArgsJson && toolArgsJson !== "{}" && (
                        <pre className="text-xs font-mono bg-muted/30 rounded-lg p-2 overflow-x-auto text-foreground">
                            {toolArgsJson}
                        </pre>
                    )}
                    <div className="flex gap-2">
                        <Button
                            onClick={onApprove}
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 text-white"
                        >
                            <Check size={14} className="mr-1" />
                            Allow
                        </Button>
                        <Button
                            onClick={onReject}
                            variant="outline"
                            size="sm"
                        >
                            <X size={14} className="mr-1" />
                            Deny
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function ChatEmptyState({
    onSelectAgent,
}: {
    onSelectAgent: (agentId: string) => void;
}) {
    const agentsMap = useAppSelector(selectAllAgents);
    const agents = useMemo(() => Object.values(agentsMap), [agentsMap]);
    const availableModels = useAppSelector(selectAvailableModels);
    const isProviderAvailable = availableModels.length > 0;
    const navigate = useNavigate();

    if (!isProviderAvailable) {
        return (
            <div className="flex-1 flex items-center justify-center p-8">
                <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 px-4 py-3 max-w-md">
                    <GearSix size={18} className="text-muted-foreground shrink-0 mt-0.5" />
                    <p className="text-sm text-muted-foreground">
                        No AI provider configured or available. Enable a provider key in{" "}
                        <button
                            type="button"
                            onClick={() => navigate("/agents/config")}
                            className="font-medium text-primary hover:text-primary/80 transition-colors underline-offset-2 hover:underline"
                        >
                            SYSTEM &rarr; Config
                        </button>{" "}
                        to start chatting.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col items-center justify-center p-8">
            <UniffyLogo className="w-12 h-12 mb-6 opacity-60" />
            <h2 className="text-lg font-semibold text-foreground mb-1">
                Start a conversation
            </h2>
            <p className="text-sm text-muted-foreground mb-8">
                Choose an agent to begin chatting
            </p>

            {agents.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-2xl w-full">
                    {agents.map((agent) => (
                        <button
                            key={agent.id}
                            type="button"
                            onClick={() => onSelectAgent(agent.id)}
                            className={cn(
                                "flex items-center gap-3 px-4 py-3 rounded-lg border border-border",
                                "bg-card hover:bg-muted transition-colors text-left",
                            )}
                        >
                            <AgentAvatar
                                avatarKey={agent.avatarKey}
                                avatarEmoji={agent.avatarEmoji}
                                agentName={agent.name}
                                size="lg"
                            />
                            <div className="min-w-0">
                                <span className="block text-sm font-medium text-foreground truncate">
                                    {agent.name}
                                </span>
                                {agent.isDefault && (
                                    <span className="text-xs text-muted-foreground">Default</span>
                                )}
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function ChatPanel() {
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const chatMessage = useAppSelector(selectChatMessage);
    const sidebarContent = useAppSelector(selectSidebarContent);
    const agentsMap = useAppSelector(selectAllAgents);
    const activeSessionId = useAppSelector(selectActiveSessionId);
    const activeSession = useAppSelector(selectActiveSession);
    const messages = useAppSelector(selectMessagesForSession(activeSessionId));
    const streamingContent = useAppSelector(selectStreamingContent);
    const streamingToolCalls = useAppSelector(selectStreamingToolCalls);
    const isStreaming = useAppSelector(selectIsStreaming);
    const activeRunId = useAppSelector(selectActiveRunId);
    const pendingConfirmation = useAppSelector(selectPendingConfirmation);
    const sessionDrafts = useAppSelector(selectSessionDrafts(activeSessionId));
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

    // Reconnect via SubscribeToRun if a run_id is already in the slice at mount
    // (navigate-back or sessionStorage rehydrate). Captured once so a later
    // runIdReceived from streamSendMessage does not retrigger the hook.
    const [reconnectRunId] = useState<string | null>(() => activeRunId);
    useAgentRunStream(reconnectRunId, organizationId ?? "", activeSessionId);
    const availableModels = useAppSelector(selectAvailableModels);
    const isProviderAvailable = availableModels.length > 0;
    const contextStats = useAppSelector(selectContextStats(activeSessionId));

    const [showStats, setShowStats] = useState(false);
    const [isCompacting, setIsCompacting] = useState(false);
    const [pendingFiles, setPendingFiles] = useState<Array<{
        id: string;
        mediaType: string;
        filename: string;
        preview: string;
        fileId?: string;
        uploading: boolean;
    }>>([]);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const contentWrapperRef = useRef<HTMLDivElement>(null);
    const isNearBottomRef = useRef(true);
    const lastScrolledSessionRef = useRef<string | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const addFile = useCallback((file: File) => {
        if (!organizationId) return;
        if (file.type.startsWith("audio/") || file.type.startsWith("video/")) {
            toast.error("Audio and video files are not supported in chat with LLMs.");
            return;
        }
        const localId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const isImage = file.type.startsWith("image/");
        const preview = isImage ? URL.createObjectURL(file) : "";

        setPendingFiles((prev) => [
            ...prev,
            {
                id: localId,
                mediaType: file.type || "application/octet-stream",
                filename: file.name,
                preview,
                uploading: true,
            },
        ]);

        uploadImage({
            file,
            organizationId,
            contentId: "",
            contentType: ContentType.FILE,
            onFileUploaded: (uploadedFileId) => {
                setPendingFiles((prev) =>
                    prev.map((f) =>
                        f.id === localId ? { ...f, fileId: uploadedFileId, uploading: false } : f,
                    ),
                );
            },
        }).catch(() => {
            setPendingFiles((prev) =>
                prev.map((f) =>
                    f.id === localId ? { ...f, uploading: false } : f,
                ),
            );
        });
    }, [organizationId]);

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;
        for (const file of files) {
            addFile(file);
        }
        e.target.value = "";
    }, [addFile]);

    const autoResizeTextarea = useCallback(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    }, []);

    useEffect(() => {
        autoResizeTextarea();
    }, [chatMessage, autoResizeTextarea]);

    const mention = useTextareaMention({
        textareaRef,
        value: chatMessage,
        onChange: (val) => dispatch(setChatMessage(val)),
    });

    const slash = useTextareaSlash({
        textareaRef,
        value: chatMessage,
        onChange: (val) => dispatch(setChatMessage(val)),
    });
    const [pendingInvokedSkill, setPendingInvokedSkill] = useState<SerializedRunnableSkill | null>(null);
    const runnableSkills = useAppSelector(selectRunnableSkillsForAgent(activeSession?.agentId));

    useEffect(() => {
        if (activeSession?.agentId) {
            dispatch(fetchRunnableSkills({ agentId: activeSession.agentId }));
        }
    }, [activeSession?.agentId, dispatch]);

    useEffect(() => {
        setPendingInvokedSkill(null);
    }, [activeSessionId]);

    const handleSlashSelect = useCallback((skill: SerializedRunnableSkill) => {
        setPendingInvokedSkill(skill);
        slash.clearSlashToken();
    }, [slash]);

    const composerChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        mention.handleChange(e);
        if (!mention.isActive) slash.handleChange(e);
        autoResizeTextarea();
    }, [mention, slash, autoResizeTextarea]);

    const renderSlashPopup = () =>
        slash.isActive && !mention.isActive ? (
            <SkillSlashPopup
                skills={runnableSkills}
                query={slash.slashQuery}
                onSelect={handleSlashSelect}
                onClose={slash.close}
            />
        ) : null;

    const renderInvokedSkillChip = () =>
        pendingInvokedSkill ? (
            <div className="flex">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 border border-primary/30 pl-2 pr-1 py-1 text-xs">
                    <Lightning size={12} weight="fill" className="text-primary" />
                    <span className="font-mono text-foreground">/{pendingInvokedSkill.name}</span>
                    <button
                        type="button"
                        onClick={() => setPendingInvokedSkill(null)}
                        className="p-0.5 rounded hover:bg-primary/20 transition-colors"
                        title="Remove skill"
                    >
                        <X size={12} className="text-muted-foreground" />
                    </button>
                </span>
            </div>
        ) : null;

    const handleScroll = useCallback(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        isNearBottomRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    }, []);

    useEffect(() => {
        if (activeSessionId) {
            dispatch(fetchMessages({ sessionId: activeSessionId }));
            dispatch(fetchSessionContextStats(activeSessionId));
        }
    }, [activeSessionId, dispatch]);

    const prevStreamingRef = useRef(false);
    useEffect(() => {
        if (prevStreamingRef.current && !isStreaming && activeSessionId) {
            dispatch(fetchSessionContextStats(activeSessionId));
            textareaRef.current?.focus();
        }
        prevStreamingRef.current = isStreaming;
    }, [isStreaming, activeSessionId, dispatch]);

    useEffect(() => {
        if (activeSessionId && !isStreaming) {
            textareaRef.current?.focus();
        }
    }, [activeSessionId, isStreaming]);

    useEffect(() => {
        lastScrolledSessionRef.current = null;
    }, [activeSessionId]);

    // Pin to bottom on first activation of each session. The repeated
    // calls absorb late image/file layout shifts: a single instant
    // scroll lands above the bottom because embedded images grow the
    // wrapper after the initial scrollHeight read.
    useEffect(() => {
        if (!activeSessionId || messages.length === 0) return;
        if (lastScrolledSessionRef.current === activeSessionId) return;
        lastScrolledSessionRef.current = activeSessionId;

        const pinToBottom = () => {
            const el = scrollContainerRef.current;
            if (!el) return;
            el.scrollTop = el.scrollHeight;
            isNearBottomRef.current = true;
        };

        pinToBottom();
        const raf = requestAnimationFrame(pinToBottom);
        const t1 = window.setTimeout(pinToBottom, 100);
        const t2 = window.setTimeout(pinToBottom, 300);
        const t3 = window.setTimeout(pinToBottom, 800);

        return () => {
            cancelAnimationFrame(raf);
            window.clearTimeout(t1);
            window.clearTimeout(t2);
            window.clearTimeout(t3);
        };
    }, [activeSessionId, messages.length]);

    useEffect(() => {
        if (isNearBottomRef.current) {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [messages.length, streamingContent, streamingToolCalls.length, pendingConfirmation]);

    useEffect(() => {
        const wrapper = contentWrapperRef.current;
        const container = scrollContainerRef.current;
        if (!wrapper || !container) return;

        const observer = new ResizeObserver(() => {
            if (isNearBottomRef.current) {
                container.scrollTop = container.scrollHeight;
            }
        });
        observer.observe(wrapper);
        return () => observer.disconnect();
    }, []);

    const handlePaste = useCallback((e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
            if (item.type.startsWith("image/")) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) addFile(file);
            }
        }
    }, [addFile]);

    const removePendingFile = useCallback((index: number) => {
        setPendingFiles((prev) => prev.filter((_, i) => i !== index));
    }, []);

    const allFilesReady = pendingFiles.length === 0 || pendingFiles.every((f) => !f.uploading);

    const handleSend = () => {
        const text = chatMessage.trim();
        if ((!text && pendingFiles.length === 0) || !activeSessionId || isStreaming || !allFilesReady) return;

        const content = text || "Please analyze the attached file(s).";

        const fileIds = pendingFiles
            .map((f) => f.fileId)
            .filter((id): id is string => !!id);

        // Cache file metadata so bubbles can display filenames and thumbnails
        if (fileIds.length > 0) {
            const metaMap: Record<string, FileMetadata> = {};
            for (const pf of pendingFiles) {
                if (pf.fileId) {
                    metaMap[pf.fileId] = { filename: pf.filename, mediaType: pf.mediaType };
                }
            }
            dispatch(cacheFileMetadata(metaMap));
        }

        dispatch(setChatMessage(""));
        setPendingFiles([]);
        dispatch(streamSendMessage({
            sessionId: activeSessionId,
            content,
            fileIds: fileIds.length > 0 ? fileIds : undefined,
            invokedSkillId: pendingInvokedSkill?.id,
            invokedSkillName: pendingInvokedSkill?.displayName,
        }));
        setPendingInvokedSkill(null);
    };

    const handleConfirmationResponse = (approved: boolean) => {
        if (!activeSessionId || !pendingConfirmation) return;
        dispatch(respondToConfirmation({
            sessionId: activeSessionId,
            toolCallId: pendingConfirmation.toolCallId,
            approved,
        }));
    };

    const handleCompact = async () => {
        if (!activeSessionId || isCompacting) return;
        setIsCompacting(true);
        try {
            const result = await dispatch(compactSession(activeSessionId)).unwrap();
            if (result.compacted) {
                toast.success(
                    `Compacted ${result.messagesCompacted} messages, saved ~${formatTokenCount(result.tokensSaved)} tokens`,
                );
            } else {
                toast.info("Context is already within budget");
            }
        } finally {
            setIsCompacting(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (slash.handleKeyDown(e)) return;
        if (mention.handleKeyDown(e)) return;
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const activeAgent = useMemo(() => {
        if (!activeSession) return null;
        return agentsMap[activeSession.agentId] ?? null;
    }, [activeSession, agentsMap]);

    const agentName = activeAgent?.name ?? "Chat";

    // Place each proposed-skill card inline, right after the assistant reply
    // that announced it, instead of stacking every draft at the bottom of the
    // thread. A draft is created mid-turn (when the propose tool runs), so its
    // turn's concluding assistant message is the first non-tool assistant
    // message at or after the draft's timestamp. Drafts with no such message in
    // the loaded thread (background-analyzer proposals created after the
    // conversation) stay unanchored and fall to the end.
    const draftAnchors = useMemo(() => {
        const byMessageId = new Map<string, SerializedSkillDraft[]>();
        const anchored = new Set<string>();
        for (const draft of sessionDrafts) {
            const reply = messages.find(
                (m) =>
                    m.role === MessageRole.ASSISTANT &&
                    !m.toolCallId &&
                    tsSeconds(m.createdAt) >= tsSeconds(draft.createdAt),
            );
            if (!reply) continue;
            const list = byMessageId.get(reply.id) ?? [];
            list.push(draft);
            byMessageId.set(reply.id, list);
            anchored.add(draft.id);
        }
        return { byMessageId, anchored };
    }, [sessionDrafts, messages]);

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileSelect}
            />
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card">
                {activeAgent && (
                    <AgentAvatar
                        avatarKey={activeAgent.avatarKey}
                        avatarEmoji={activeAgent.avatarEmoji}
                        agentName={activeAgent.name}
                        size="sm"
                    />
                )}
                <span className="font-semibold text-foreground">{agentName}</span>
                {activeSession?.displayName && (
                    <Badge variant="secondary" className="font-mono text-xs">
                        {activeSession.displayName}
                    </Badge>
                )}
                <div className="flex-1" />
                {isStreaming && (
                    <>
                        <CircleNotch size={16} className="animate-spin text-muted-foreground" />
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => dispatch(cancelActiveRun())}
                            className="gap-1.5 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                            title="Stop streaming"
                        >
                            <Stop size={14} weight="fill" />
                            <span className="text-xs">Stop</span>
                        </Button>
                    </>
                )}
                {contextStats && (() => {
                    const pct = contextStats.tokenBudget > 0
                        ? Math.round((contextStats.activeTokens / contextStats.tokenBudget) * 100)
                        : 0;
                    const badgeColor = pct >= 80
                        ? "text-red-600 dark:text-red-400"
                        : pct >= 50
                            ? "text-yellow-600 dark:text-yellow-400"
                            : "text-muted-foreground";
                    return (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowStats((v) => !v)}
                            className={cn("gap-1.5", badgeColor)}
                        >
                            <Database size={14} />
                            <span className="text-xs tabular-nums">
                                {formatTokenCount(contextStats.activeTokens)}/{formatTokenCount(contextStats.tokenBudget)}
                            </span>
                        </Button>
                    );
                })()}
            </div>

            {/* Context stats panel */}
            {showStats && contextStats && (() => {
                const usagePercent = contextStats.tokenBudget > 0
                    ? Math.min(100, Math.round((contextStats.activeTokens / contextStats.tokenBudget) * 100))
                    : 0;
                const barColor = usagePercent >= 80
                    ? "bg-red-500 dark:bg-red-400"
                    : usagePercent >= 50
                        ? "bg-yellow-500 dark:bg-yellow-400"
                        : "bg-emerald-500 dark:bg-emerald-400";
                const percentColor = usagePercent >= 80
                    ? "text-red-600 dark:text-red-400"
                    : usagePercent >= 50
                        ? "text-yellow-600 dark:text-yellow-400"
                        : "text-muted-foreground";

                const targetTokens = Math.round(contextStats.contextWindowTokens * 0.4);
                const freeableTokens = Math.max(0, contextStats.activeTokens - targetTokens);
                const canCompact = contextStats.activeMessages > 2;

                return (
                    <div className="px-4 py-2.5 border-b border-border bg-muted/30 space-y-2">
                        {/* Progress bar */}
                        <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                                <div
                                    className={cn("h-full rounded-full transition-all duration-300", barColor)}
                                    style={{ width: `${usagePercent}%` }}
                                />
                            </div>
                            <span className={cn("text-xs tabular-nums font-medium", percentColor)}>
                                {usagePercent}%
                            </span>
                        </div>

                        {/* Stats breakdown */}
                        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                            <span>
                                Active: <span className="font-medium text-foreground">{formatTokenCount(contextStats.activeTokens)}</span> tokens
                                {contextStats.activeTokens > 0 && (
                                    <span className="text-muted-foreground/70">
                                        {' '}(in <span className="font-medium text-foreground">{formatTokenCount(contextStats.lastInputTokens)}</span>
                                        {contextStats.lastCacheReadTokens > 0 && (
                                            <>
                                                , <span className="font-medium text-emerald-500">{formatTokenCount(contextStats.lastCacheReadTokens)} cached</span>
                                            </>
                                        )}
                                        {' '}/ out <span className="font-medium text-foreground">{formatTokenCount(contextStats.lastOutputTokens)}</span>)
                                    </span>
                                )}
                                {' '}({contextStats.activeMessages} msgs)
                            </span>
                            {contextStats.summaryCount > 0 && (
                                <span>
                                    Summaries: <span className="font-medium text-foreground">{contextStats.summaryCount}</span>
                                </span>
                            )}
                            {contextStats.compactedMessages > 0 && (
                                <span>
                                    Compacted: <span className="font-medium text-foreground">{contextStats.compactedMessages}</span> msgs
                                </span>
                            )}
                            <span>
                                Window: <span className="font-medium text-foreground">{formatTokenCount(contextStats.contextWindowTokens)}</span>
                            </span>
                            <span>
                                Budget: <span className="font-medium text-foreground">{formatTokenCount(contextStats.tokenBudget)}</span> (65%)
                            </span>
                        </div>

                        {/* Compact button with estimated savings */}
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleCompact}
                                disabled={isCompacting || isStreaming || !canCompact}
                                className="h-6 px-2.5 text-xs gap-1.5"
                            >
                                <ArrowsClockwise size={12} className={cn(isCompacting && "animate-spin")} />
                                {!canCompact
                                    ? "Nothing to compact"
                                    : freeableTokens > 0
                                        ? `Compact (~${formatTokenCount(freeableTokens)} freeable)`
                                        : "Force compact"
                                }
                            </Button>
                            {contextStats.tokensUntilCompaction > 0 ? (
                                <span className="text-xs text-muted-foreground">
                                    <span className="font-medium text-foreground">{formatTokenCount(contextStats.tokensUntilCompaction)}</span> until auto-compaction
                                </span>
                            ) : (
                                <span className="text-xs text-yellow-600 dark:text-yellow-400">
                                    Auto-compaction will trigger on next message
                                </span>
                            )}
                        </div>
                    </div>
                );
            })()}

            {/* Empty state - centered input */}
            {messages.length === 0 && !isStreaming ? (
                <div className="flex-1 flex flex-col items-center justify-center px-4">
                    <div className="w-full max-w-2xl flex flex-col items-center gap-6">
                        <div className="flex flex-col items-center gap-2">
                            {activeAgent ? (
                                <>
                                    <AgentAvatar
                                        avatarKey={activeAgent.avatarKey}
                                        avatarEmoji={activeAgent.avatarEmoji}
                                        agentName={activeAgent.name}
                                        size="xl"
                                    />
                                    <h2 className="text-lg font-semibold text-foreground">
                                        {activeAgent.name}
                                    </h2>
                                </>
                            ) : (
                                <p className="text-muted-foreground">
                                    Start a conversation
                                </p>
                            )}
                        </div>

                        {/* Mention spotlight popup */}
                        {mention.isActive && (
                            <ChatMentionPopup
                                initialQuery={mention.mentionQuery}
                                onSelect={mention.handleSelect}
                                onClose={mention.close}
                            />
                        )}

                        {isProviderAvailable ? (
                            <div className="w-full flex flex-col gap-2">
                                {pendingFiles.length > 0 && (
                                    <div className="flex gap-2 flex-wrap">
                                        {pendingFiles.map((file, idx) => (
                                            <div
                                                key={file.id}
                                                className={cn(
                                                    "relative group rounded-lg overflow-hidden border border-border bg-muted",
                                                    file.preview ? "w-16 h-16" : "h-16 px-3 flex items-center gap-2",
                                                )}
                                            >
                                                {file.preview ? (
                                                    <img
                                                        src={file.preview}
                                                        alt={file.filename}
                                                        className={cn(
                                                            "w-full h-full object-cover",
                                                            file.uploading && "opacity-50",
                                                        )}
                                                    />
                                                ) : (
                                                    <>
                                                        <FileText size={20} className={cn("text-muted-foreground shrink-0", file.uploading && "opacity-50")} />
                                                        <span className={cn("text-xs text-foreground truncate max-w-[120px]", file.uploading && "opacity-50")}>
                                                            {file.filename}
                                                        </span>
                                                    </>
                                                )}
                                                {file.uploading && (
                                                    <div className="absolute inset-0 flex items-center justify-center">
                                                        <CircleNotch size={16} className="animate-spin text-foreground" />
                                                    </div>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => removePendingFile(idx)}
                                                    className="absolute top-0 right-0 p-0.5 bg-background/80 rounded-bl-md opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <X size={12} className="text-foreground" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {renderInvokedSkillChip()}
                                <div className="relative flex flex-col bg-muted border border-border rounded-lg focus-within:ring-1 focus-within:ring-ring">
                                    {renderSlashPopup()}
                                    <textarea
                                        ref={textareaRef}
                                        className="w-full bg-transparent px-3 pt-2 pb-10 text-sm resize-none text-foreground placeholder:text-muted-foreground focus:outline-none"
                                        placeholder={pendingFiles.length > 0 ? "Add a message about the attached file(s)..." : "Type a message... @ to mention, / to run a skill"}
                                        rows={3}
                                        value={chatMessage}
                                        onChange={composerChange}
                                        onKeyDown={handleKeyDown}
                                        onPaste={handlePaste}
                                        disabled={isStreaming}
                                        style={{ maxHeight: 200 }}
                                    />
                                    <div className="absolute bottom-2 left-2">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                            onClick={() => fileInputRef.current?.click()}
                                            disabled={isStreaming}
                                            title="Attach image"
                                        >
                                            <Paperclip size={16} />
                                        </Button>
                                    </div>
                                    <div className="absolute bottom-2 right-2">
                                        <Button
                                            onClick={handleSend}
                                            disabled={isStreaming || !allFilesReady || (!chatMessage.trim() && pendingFiles.length === 0)}
                                            size="sm"
                                        >
                                            <PaperPlaneRight size={16} />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="w-full flex items-start gap-3 rounded-lg border border-border bg-muted/50 px-4 py-3">
                                <GearSix size={18} className="text-muted-foreground shrink-0 mt-0.5" />
                                <p className="text-sm text-muted-foreground">
                                    No AI provider configured or available. Enable a provider key in{" "}
                                    <button
                                        type="button"
                                        onClick={() => navigate("/agents/config")}
                                        className="font-medium text-primary hover:text-primary/80 transition-colors underline-offset-2 hover:underline"
                                    >
                                        SYSTEM &rarr; Config
                                    </button>{" "}
                                    to start chatting.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <>
                    {/* Messages */}
                    <div className="flex-1 flex overflow-hidden">
                        <Group
                            orientation="horizontal"
                            className="h-full w-full flex"
                        >
                            <Panel id="chat-messages" minSize={300}>
                                <div
                                    ref={scrollContainerRef}
                                    className="h-full flex flex-col overflow-y-auto p-4 space-y-4"
                                    onScroll={handleScroll}
                                >
                                    <div ref={contentWrapperRef} className="flex flex-col space-y-4">
                                        {(() => {
                                            const elements: React.ReactNode[] = [];
                                            const pushDraftsAfter = (messageId: string) => {
                                                for (const draft of draftAnchors.byMessageId.get(messageId) ?? []) {
                                                    elements.push(
                                                        <ProposedSkillDraftCard key={`draft-${draft.id}`} draft={draft} />,
                                                    );
                                                }
                                            };
                                            let i = 0;
                                            while (i < messages.length) {
                                                const message = messages[i];
                                                if (message.role === MessageRole.USER) {
                                                    elements.push(<UserBubble key={message.id} message={message} />);
                                                    i++;
                                                } else if (message.role === MessageRole.TOOL) {
                                                    const group: SerializedMessage[] = [];
                                                    while (i < messages.length && messages[i].role === MessageRole.TOOL) {
                                                        group.push(messages[i]);
                                                        i++;
                                                    }
                                                    elements.push(<ToolCallGroup key={group[0].id} messages={group} />);
                                                } else {
                                                    // Skip intermediate tool-loop assistant messages (toolCallId set) - their content is preamble repeated before each tool call.
                                                    if (!message.toolCallId) {
                                                        elements.push(<AssistantBubble key={message.id} message={message} />);
                                                        pushDraftsAfter(message.id);
                                                    }
                                                    i++;
                                                }
                                            }
                                            return elements;
                                        })()}

                                        {isStreaming && !streamingContent && streamingToolCalls.length === 0 && !pendingConfirmation && (
                                            <ThinkingIndicator agent={activeAgent} />
                                        )}

                                        <StreamingToolCards toolCalls={streamingToolCalls} />

                                        {pendingConfirmation && (
                                            <ConfirmationDialog
                                                toolName={pendingConfirmation.toolName}
                                                toolArgsJson={pendingConfirmation.toolArgsJson}
                                                description={pendingConfirmation.description}
                                                onApprove={() => handleConfirmationResponse(true)}
                                                onReject={() => handleConfirmationResponse(false)}
                                            />
                                        )}

                                        <StreamingBubble content={streamingContent} />

                                        {sessionDrafts
                                            .filter((draft) => !draftAnchors.anchored.has(draft.id))
                                            .map((draft) => (
                                                <ProposedSkillDraftCard key={draft.id} draft={draft} />
                                            ))}
                                    </div>

                                    <div ref={messagesEndRef} />
                                </div>
                            </Panel>

                            {sidebarContent && (
                                <>
                                    <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />
                                    <Panel
                                        id="chat-tool-output"
                                        defaultSize={320}
                                        minSize={200}
                                        maxSize={500}
                                        className="bg-card overflow-hidden"
                                    >
                                        <div className="h-full flex flex-col">
                                            <div className="px-4 py-2 border-b border-border flex items-center justify-between">
                                                <span className="font-medium text-foreground text-sm">
                                                    Tool Output
                                                </span>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => dispatch(setSidebarContent(null))}
                                                >
                                                    <X size={16} />
                                                </Button>
                                            </div>
                                            <div className="flex-1 overflow-y-auto p-4">
                                                <pre className="font-mono text-sm whitespace-pre-wrap text-foreground">
                                                    {sidebarContent}
                                                </pre>
                                            </div>
                                        </div>
                                    </Panel>
                                </>
                            )}
                        </Group>
                    </div>

                    {/* Mention spotlight popup */}
                    {mention.isActive && (
                        <ChatMentionPopup
                            initialQuery={mention.mentionQuery}
                            onSelect={mention.handleSelect}
                            onClose={mention.close}
                        />
                    )}

                    {/* Input */}
                    <div className="border-t border-border bg-card px-4 py-3">
                        {isProviderAvailable ? (
                            <div className="flex flex-col gap-2">
                                {pendingFiles.length > 0 && (
                                    <div className="flex gap-2 flex-wrap">
                                        {pendingFiles.map((file, idx) => (
                                            <div
                                                key={file.id}
                                                className={cn(
                                                    "relative group rounded-lg overflow-hidden border border-border bg-muted",
                                                    file.preview ? "w-16 h-16" : "h-16 px-3 flex items-center gap-2",
                                                )}
                                            >
                                                {file.preview ? (
                                                    <img
                                                        src={file.preview}
                                                        alt={file.filename}
                                                        className={cn(
                                                            "w-full h-full object-cover",
                                                            file.uploading && "opacity-50",
                                                        )}
                                                    />
                                                ) : (
                                                    <>
                                                        <FileText size={20} className={cn("text-muted-foreground shrink-0", file.uploading && "opacity-50")} />
                                                        <span className={cn("text-xs text-foreground truncate max-w-[120px]", file.uploading && "opacity-50")}>
                                                            {file.filename}
                                                        </span>
                                                    </>
                                                )}
                                                {file.uploading && (
                                                    <div className="absolute inset-0 flex items-center justify-center">
                                                        <CircleNotch size={16} className="animate-spin text-foreground" />
                                                    </div>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => removePendingFile(idx)}
                                                    className="absolute top-0 right-0 p-0.5 bg-background/80 rounded-bl-md opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <X size={12} className="text-foreground" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {renderInvokedSkillChip()}
                                <div className="relative flex flex-col bg-muted border border-border rounded-lg focus-within:ring-1 focus-within:ring-ring">
                                    {renderSlashPopup()}
                                    <textarea
                                        ref={textareaRef}
                                        className="w-full bg-transparent px-3 pt-2 pb-10 text-sm resize-none text-foreground placeholder:text-muted-foreground focus:outline-none"
                                        placeholder={pendingFiles.length > 0 ? "Add a message about the attached file(s)..." : "Type a message... @ to mention, / to run a skill"}
                                        rows={3}
                                        value={chatMessage}
                                        onChange={composerChange}
                                        onKeyDown={handleKeyDown}
                                        onPaste={handlePaste}
                                        disabled={isStreaming}
                                        style={{ maxHeight: 200 }}
                                    />
                                    <div className="absolute bottom-2 left-2">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                            onClick={() => fileInputRef.current?.click()}
                                            disabled={isStreaming}
                                            title="Attach image"
                                        >
                                            <Paperclip size={16} />
                                        </Button>
                                    </div>
                                    <div className="absolute bottom-2 right-2">
                                        <Button
                                            onClick={handleSend}
                                            disabled={isStreaming || !allFilesReady || (!chatMessage.trim() && pendingFiles.length === 0)}
                                            size="sm"
                                        >
                                            <PaperPlaneRight size={16} />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 px-4 py-3">
                                <GearSix size={18} className="text-muted-foreground shrink-0 mt-0.5" />
                                <p className="text-sm text-muted-foreground">
                                    No AI provider configured or available. Enable a provider key in{" "}
                                    <button
                                        type="button"
                                        onClick={() => navigate("/agents/config")}
                                        className="font-medium text-primary hover:text-primary/80 transition-colors underline-offset-2 hover:underline"
                                    >
                                        SYSTEM &rarr; Config
                                    </button>{" "}
                                    to start chatting.
                                </p>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

export function ChatView() {
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const isZenMode = useAppSelector((state) => state.zenMode.isActive);
    const activeSessionId = useAppSelector(selectActiveSessionId);

    const [defaultLayout] = useState(() => loadPanelLayout("agents-chat"));

    const handleLayoutChange = useCallback(
        (layout: Record<string, number>) => {
            savePanelLayout("agents-chat", layout);
        },
        [],
    );

    useEffect(() => {
        dispatch(fetchAgents());
        dispatch(fetchSessions());
        dispatch(fetchAvailableModels());
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleStartChat = useCallback(
        (agentId: string) => {
            dispatch(createSession({ agentId, kind: SessionKind.DIRECT }))
                .unwrap()
                .then((session) => navigate(`/agents/chat/${session.id}`))
                .catch(() => {});
        },
        [dispatch, navigate],
    );

    const showSidebar = !isZenMode;

    return (
        <div className="flex h-full overflow-hidden">
            <Group
                orientation="horizontal"
                className="h-full w-full flex"
                defaultLayout={defaultLayout}
                onLayoutChange={handleLayoutChange}
            >
                {/* Session sidebar */}
                {showSidebar && (
                    <>
                        <Panel
                            id="chat-sidebar"
                            defaultSize={260}
                            minSize={200}
                            maxSize={360}
                            className="border-r border-border"
                        >
                            <ChatSessionSidebar />
                        </Panel>

                        <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />
                    </>
                )}

                {/* Chat content */}
                <Panel
                    id="chat-main"
                    minSize={300}
                    className="flex flex-col overflow-hidden"
                >
                    {activeSessionId ? (
                        <ChatPanel />
                    ) : (
                        <ChatEmptyState onSelectAgent={handleStartChat} />
                    )}
                </Panel>
            </Group>
        </div>
    );
}
