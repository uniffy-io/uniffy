import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
    PaperPlaneRight,
    ArrowSquareIn,
    ArrowCounterClockwise,
    CircleNotch,
    Eye,
    ArrowClockwise,
    CaretDown,
    CaretRight,
    ChatCircleDots,
    X,
    PencilSimple,
    Notebook,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { useMyPermission } from "@/features/sharing";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { createSession } from "@/features/agents/store/agentSessionsThunks";
import { SessionKind } from "@uniffy/proto/agents/v1/sessions_pb";
import { PROMPT_BUILDER_PREFIX } from "@/features/agents/store/agentSessionsSlice";
import {
    selectMessagesForSession,
    selectStreamingContent,
    selectIsStreaming,
} from "@/features/agents/store/agentMessagesSlice";
import {
    fetchMessages,
    streamSendMessage,
    MessageRole,
} from "@/features/agents/store/agentMessagesThunks";
import { updateAgent, previewSystemPrompt } from "@/features/agents/store/agentsThunks";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";
import type { SerializedMessage } from "@/features/agents/store/agentMessagesThunks";
import { CrepeEditor } from "@/components/editor/CrepeEditor";
import { Button } from "@/components/ui/button";
import { Select, type SelectOption } from "@/components/ui/select";
import { selectAllPrompts } from "@/features/agents/store/agentPromptsSlice";
import { fetchPrompts } from "@/features/agents/store/agentPromptsThunks";
import { PromptSource } from "@uniffy/proto/agents/v1/prompts_pb";

function formatTime(ts?: { seconds: number; nanos: number }): string {
    if (!ts) return "";
    return new Date(ts.seconds * 1000).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
    });
}

// ---------------------------------------------------------------------------
// Chat Bubble
// ---------------------------------------------------------------------------

function ChatBubble({
    message,
    onApply,
}: {
    message: SerializedMessage;
    onApply?: (content: string) => void;
}) {
    const isUser = message.role === MessageRole.USER;

    if (isUser) {
        return (
            <div className="flex justify-end">
                <div className="max-w-[85%]">
                    <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-3.5 py-2">
                        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground text-right mt-0.5 px-1">
                        {formatTime(message.createdAt)}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex justify-start">
            <div className="max-w-[85%]">
                <div className="rounded-2xl rounded-bl-sm px-3.5 py-2 bg-muted">
                    <div className="prose prose-sm dark:prose-invert max-w-none text-foreground prose-p:my-1 prose-pre:my-2 prose-ul:my-1 prose-ol:my-1 prose-headings:my-2 prose-code:text-primary prose-code:before:content-none prose-code:after:content-none">
                        <Markdown remarkPlugins={[remarkGfm]}>
                            {message.content ?? ""}
                        </Markdown>
                    </div>
                    {onApply && message.content && (
                        <button
                            type="button"
                            onClick={() => onApply(message.content ?? "")}
                            className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                        >
                            <ArrowSquareIn size={14} />
                            Apply to Instructions
                        </button>
                    )}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 px-1">
                    {formatTime(message.createdAt)}
                </p>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Thinking Indicator
// ---------------------------------------------------------------------------

const THINKING_PHASES = [
    "Understanding your request",
    "Analyzing agent requirements",
    "Structuring instructions",
    "Crafting system prompt",
    "Refining tone and constraints",
    "Finalizing instructions",
];

function ThinkingIndicator() {
    const [phaseIndex, setPhaseIndex] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setPhaseIndex((prev) =>
                prev < THINKING_PHASES.length - 1 ? prev + 1 : prev
            );
        }, 2400);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm px-3.5 py-2.5 bg-muted">
                <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
                    </div>
                    <span
                        key={phaseIndex}
                        className="text-sm text-muted-foreground italic animate-[fadeIn_0.4s_ease-in]"
                    >
                        {THINKING_PHASES[phaseIndex]}
                    </span>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Prompt Builder Drawer (slide-over panel)
// ---------------------------------------------------------------------------

function PromptBuilderDrawer({
    agent,
    canEdit,
    open,
    onClose,
}: {
    agent: SerializedAgent;
    canEdit: boolean;
    open: boolean;
    onClose: () => void;
}) {
    const dispatch = useAppDispatch();
    const [inputValue, setInputValue] = useState("");
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [chatKey, setChatKey] = useState(0);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const messages = useAppSelector(selectMessagesForSession(sessionId));
    const streamingContent = useAppSelector(selectStreamingContent);
    const isStreaming = useAppSelector(selectIsStreaming);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        dispatch(
            createSession({
                agentId: agent.id,
                displayName: `${PROMPT_BUILDER_PREFIX}${agent.name}`,
                kind: SessionKind.GROUP,
            })
        )
            .unwrap()
            .then((session) => {
                if (!cancelled) setSessionId(session.id);
            });
        return () => { cancelled = true; };
    }, [agent.id, agent.name, dispatch, open, chatKey]);

    useEffect(() => {
        if (sessionId) dispatch(fetchMessages({ sessionId }));
    }, [sessionId, dispatch]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages.length, streamingContent]);

    const autoResize = useCallback(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
    }, []);

    useEffect(() => { autoResize(); }, [inputValue, autoResize]);

    const handleSend = useCallback(() => {
        const content = inputValue.trim();
        if (!content || !sessionId || isStreaming) return;
        setInputValue("");
        dispatch(streamSendMessage({ sessionId, content }));
    }, [inputValue, sessionId, isStreaming, dispatch]);

    const handleApply = useCallback(
        (content: string) => {
            if (!canEdit) return;
            dispatch(updateAgent({ agentId: agent.id, soulPrompt: content }));
        },
        [agent.id, canEdit, dispatch]
    );

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const hasMessages = messages.length > 0 || isStreaming;

    return (
        <div
            className={cn(
                "absolute inset-y-0 right-0 z-20 flex flex-col bg-card border-l border-border shadow-xl transition-transform duration-200 ease-out",
                "w-[380px] max-w-[90%]",
                open ? "translate-x-0" : "translate-x-full pointer-events-none",
            )}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                    <ChatCircleDots size={18} weight="duotone" className="text-primary" />
                    <span className="text-sm font-semibold text-foreground">Prompt Builder</span>
                </div>
                <div className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                            setSessionId(null);
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
                        onClick={onClose}
                        className="h-7 w-7"
                    >
                        <X size={14} />
                    </Button>
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto">
                {!sessionId ? (
                    <div className="flex items-center justify-center h-full">
                        <CircleNotch size={24} className="animate-spin text-muted-foreground" />
                    </div>
                ) : !hasMessages ? (
                    <div className="flex flex-col items-center justify-center h-full px-6 py-8 text-center">
                        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                            <PencilSimple size={24} weight="duotone" className="text-primary" />
                        </div>
                        <p className="text-sm font-medium text-foreground mb-1">
                            AI Prompt Builder
                        </p>
                        <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
                            Describe what your agent should do and the AI will generate
                            system instructions. Click "Apply" on any response to set it
                            as the agent's instructions.
                        </p>
                    </div>
                ) : (
                    <div className="p-3 space-y-3">
                        {messages.map((msg) => (
                            <ChatBubble
                                key={msg.id}
                                message={msg}
                                onApply={
                                    msg.role === MessageRole.ASSISTANT && canEdit
                                        ? handleApply
                                        : undefined
                                }
                            />
                        ))}
                        {isStreaming && !streamingContent && <ThinkingIndicator />}
                        {streamingContent && (
                            <div className="flex justify-start">
                                <div className="max-w-[85%]">
                                    <div className="rounded-2xl rounded-bl-sm px-3.5 py-2 bg-muted">
                                        <div className="prose prose-sm dark:prose-invert max-w-none text-foreground prose-p:my-1">
                                            <Markdown remarkPlugins={[remarkGfm]}>
                                                {streamingContent}
                                            </Markdown>
                                        </div>
                                        <span className="inline-block w-1.5 h-4 bg-foreground/40 animate-pulse ml-0.5" />
                                    </div>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>

            {/* Input */}
            <div className="border-t border-border bg-card px-3 py-2.5 shrink-0">
                <div className="relative flex flex-col bg-muted border border-border rounded-lg focus-within:ring-1 focus-within:ring-ring">
                    <textarea
                        ref={textareaRef}
                        className="w-full bg-transparent px-3 pt-2 pb-9 text-sm resize-none text-foreground placeholder:text-muted-foreground focus:outline-none overflow-y-auto"
                        style={{ maxHeight: 140 }}
                        placeholder="Describe what your agent should do..."
                        rows={2}
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={isStreaming || !sessionId}
                    />
                    <div className="absolute bottom-2 right-2">
                        <Button
                            onClick={handleSend}
                            disabled={isStreaming || !inputValue.trim() || !sessionId}
                            size="sm"
                        >
                            <PaperPlaneRight size={14} />
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Assembled Prompt Preview
// ---------------------------------------------------------------------------

function AssembledPromptPreview({ agent }: { agent: SerializedAgent }) {
    const dispatch = useAppDispatch();
    const [expanded, setExpanded] = useState(true);
    const [promptText, setPromptText] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Fingerprint of fields that affect the assembled prompt
    const promptFingerprint = useMemo(
        () => [
            agent.id,
            agent.soulPrompt,
            agent.name,
            agent.promptId,
            agent.enabledTools.join(","),
            agent.enabledSkills.join(","),
        ].join("|"),
        [agent.id, agent.soulPrompt, agent.name, agent.promptId, agent.enabledTools, agent.enabledSkills],
    );

    // Auto-fetch on mount and debounce re-fetch when fingerprint changes
    useEffect(() => {
        if (!expanded) return;

        if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
        fetchTimeoutRef.current = setTimeout(() => {
            setLoading(true);
            dispatch(previewSystemPrompt(agent.id))
                .unwrap()
                .then((text) => setPromptText(text))
                .finally(() => setLoading(false));
        }, 500);

        return () => {
            if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
        };
    }, [promptFingerprint, expanded, agent.id, dispatch]);

    const handleToggle = useCallback(() => {
        setExpanded((prev) => !prev);
    }, []);

    const handleRefresh = useCallback(() => {
        setLoading(true);
        dispatch(previewSystemPrompt(agent.id))
            .unwrap()
            .then((text) => setPromptText(text))
            .finally(() => setLoading(false));
    }, [agent.id, dispatch]);

    return (
        <div>
            <button
                type="button"
                onClick={handleToggle}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
                {expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
                <Eye size={16} />
                <span className="font-medium">Assembled System Prompt</span>
                {promptText !== null && (
                    <span className="text-xs text-muted-foreground ml-1">
                        ({promptText.length.toLocaleString()} chars)
                    </span>
                )}
            </button>
            {expanded && (
                <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">
                            Preview of the full prompt sent to the LLM. The platform automatically
                            appends agent metadata, enabled tools, active skills, user memories,
                            and the prompt template to your custom instructions.
                        </p>
                        <button
                            type="button"
                            onClick={handleRefresh}
                            disabled={loading}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                        >
                            {loading ? (
                                <CircleNotch size={14} className="animate-spin" />
                            ) : (
                                <ArrowClockwise size={14} />
                            )}
                            Refresh
                        </button>
                    </div>
                    {loading && promptText === null ? (
                        <div className="flex items-center justify-center py-8">
                            <CircleNotch size={24} className="animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <div className="border border-border rounded-lg overflow-hidden bg-muted/50">
                            <CrepeEditor
                                contentType={ContentType.AGENT}
                                contentId={agent.id}
                                value={promptText ?? ""}
                                readonly
                                enableUpload={false}
                                compact
                            />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Soul Prompt Editor (main editor area)
// ---------------------------------------------------------------------------

function SoulPromptEditor({
    agent,
    canEdit,
}: {
    agent: SerializedAgent;
    canEdit: boolean;
}) {
    const dispatch = useAppDispatch();
    const [localValue, setLocalValue] = useState(agent.soulPrompt);
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Reset local value when agent changes
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting state when agent.id changes
        setLocalValue(agent.soulPrompt);
    }, [agent.id, agent.soulPrompt]);

    const handleChange = useCallback((markdown: string) => {
        setLocalValue(markdown);

        // Debounced auto-save
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
            dispatch(updateAgent({ agentId: agent.id, soulPrompt: markdown }));
        }, 800);
    }, [agent.id, dispatch]);

    // Flush on unmount
    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        };
    }, []);

    return (
        <CrepeEditor
            contentType={ContentType.AGENT}
            contentId={agent.id}
            value={localValue}
            onChange={canEdit ? handleChange : undefined}
            readonly={!canEdit}
            enableUpload={false}
            compact
            minHeight="200px"
            placeholder="Write your agent's personality, instructions, and behavioral guidelines here... (markdown supported)"
        />
    );
}

// ---------------------------------------------------------------------------
// Main InstructionsTab
// ---------------------------------------------------------------------------

export function InstructionsTab({ agent }: { agent: SerializedAgent }) {
    const dispatch = useAppDispatch();
    const { permission } = useMyPermission(ContentType.AGENT, agent.id);
    const canEdit = permission?.canEdit ?? permission?.isOwner ?? true;
    const [drawerOpen, setDrawerOpen] = useState(false);
    const promptsMap = useAppSelector(selectAllPrompts);

    useEffect(() => {
        dispatch(fetchPrompts());
    }, [dispatch]);

    const NONE_VALUE = "__none__";

    const promptOptions: SelectOption<string>[] = useMemo(() => {
        const opts: SelectOption<string>[] = [
            { value: NONE_VALUE, label: "None" },
        ];
        for (const prompt of Object.values(promptsMap)) {
            const sourceLabel =
                prompt.source === PromptSource.BUNDLED
                    ? "Bundled"
                    : prompt.source === PromptSource.ORGANIZATION
                      ? "Org"
                      : "Personal";
            opts.push({
                value: prompt.id,
                label: `${prompt.displayName} (${sourceLabel})`,
            });
        }
        return opts;
    }, [promptsMap]);

    const selectValue = agent.promptId || NONE_VALUE;

    const handlePromptChange = useCallback(
        (value: string) => {
            if (value === NONE_VALUE) {
                dispatch(updateAgent({ agentId: agent.id, clearPrompt: true }));
            } else {
                dispatch(updateAgent({ agentId: agent.id, promptId: value }));
            }
        },
        [agent.id, dispatch],
    );

    return (
        <div className="relative flex flex-col h-full overflow-hidden">
            {/* Scrollable content area */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-300">
                    {/* Prompt Template Selector */}
                    <div className="bg-card border border-border rounded-xl overflow-hidden">
                        <div className="h-1 bg-gradient-to-r from-primary/80 via-primary/40 to-transparent" />
                        <div className="p-6">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                                    <Notebook size={18} weight="duotone" className="text-primary" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-foreground tracking-tight">
                                        Prompt Template
                                    </h3>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        Optional predefined template appended to the system prompt.
                                        Provides workspace context and platform guidelines.
                                    </p>
                                </div>
                            </div>
                            <Select
                                value={selectValue}
                                onChange={handlePromptChange}
                                options={promptOptions}
                                placeholder="Select a prompt template..."
                                disabled={!canEdit}
                                className="w-full"
                            />
                        </div>
                    </div>

                    {/* Custom Instructions Editor */}
                    <div className="bg-card border border-border rounded-xl overflow-hidden">
                        <div className="p-6 pb-4">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                                        <PencilSimple size={18} weight="duotone" className="text-primary" />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-semibold text-foreground tracking-tight">
                                            Custom Instructions
                                        </h3>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            Define your agent's personality, behavior, and guidelines.
                                            Placed at the top of the system prompt.
                                        </p>
                                    </div>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setDrawerOpen(true)}
                                    className="gap-1.5"
                                >
                                    <ChatCircleDots size={14} weight="duotone" />
                                    AI Builder
                                </Button>
                            </div>
                            <div className="border border-border rounded-lg overflow-hidden bg-muted/30">
                                <SoulPromptEditor agent={agent} canEdit={canEdit} />
                            </div>
                        </div>
                    </div>

                    {/* Assembled Prompt Preview */}
                    <div className="bg-card border border-border rounded-xl overflow-hidden">
                        <div className="p-6">
                            <AssembledPromptPreview agent={agent} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Prompt builder drawer (slides from right) */}
            <PromptBuilderDrawer
                agent={agent}
                canEdit={canEdit}
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
            />

            {/* Backdrop when drawer is open */}
            {drawerOpen && (
                <div
                    className="absolute inset-0 z-10 bg-background/40 backdrop-blur-[2px] transition-opacity"
                    onClick={() => setDrawerOpen(false)}
                />
            )}
        </div>
    );
}
