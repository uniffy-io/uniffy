/**
 * ChatSessionSidebar - Session list sidebar for the chat view.
 *
 * Shows all user sessions sorted by most recent activity.
 * Includes a "New Chat" button with agent picker, session switching,
 * inline rename (double-click), and archive (hover action).
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { Trash, ChatCircle } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";
import { selectAllAgents } from "@/features/agents/store/agentsSlice";
import {
    selectActiveSessionId,
    selectSortedUserSessions,
    setActiveSession,
} from "@/features/agents/store/agentSessionsSlice";
import {
    createSession,
    updateSession,
    archiveSession,
} from "@/features/agents/store/agentSessionsThunks";
import { SessionKind } from "@/gen/agents/v1/sessions_pb";
import type { SerializedSession } from "@/features/agents/store/agentSessionsThunks";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";
import { AgentPicker } from "@/features/agents/components/chat/AgentPicker";
import { AgentAvatar } from "@/features/agents/components/AgentAvatar";

function timestampToDateStr(ts?: { seconds: number; nanos: number }): string | undefined {
    if (!ts || !ts.seconds) return undefined;
    return new Date(ts.seconds * 1000).toISOString();
}

interface SessionItemProps {
    session: SerializedSession;
    agentName: string;
    agentEmoji: string;
    agentAvatarKey: string;
    isActive: boolean;
    onSelect: (id: string) => void;
    onArchive: (id: string) => void;
    onRename: (id: string, name: string) => void;
}

function SessionItem({
    session,
    agentName,
    agentEmoji,
    agentAvatarKey,
    isActive,
    onSelect,
    onArchive,
    onRename,
}: SessionItemProps) {
    const [editing, setEditing] = useState(false);
    const [editValue, setEditValue] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editing]);

    const handleDoubleClick = useCallback(() => {
        setEditValue(session.displayName || "");
        setEditing(true);
    }, [session.displayName]);

    const handleRenameSubmit = useCallback(() => {
        const trimmed = editValue.trim();
        if (trimmed && trimmed !== session.displayName) {
            onRename(session.id, trimmed);
        }
        setEditing(false);
    }, [editValue, session.id, session.displayName, onRename]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter") {
                handleRenameSubmit();
            } else if (e.key === "Escape") {
                setEditing(false);
            }
        },
        [handleRenameSubmit],
    );

    const displayName = session.displayName || agentName;
    const relativeTime = formatRelativeTime(timestampToDateStr(session.updatedAt));

    return (
        <button
            type="button"
            onClick={() => onSelect(session.id)}
            onDoubleClick={handleDoubleClick}
            className={cn(
                "group flex items-center gap-2.5 w-full px-3 py-2.5 text-left rounded-lg transition-colors",
                isActive
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
        >
            <AgentAvatar
                avatarKey={agentAvatarKey}
                avatarEmoji={agentEmoji}
                agentName={agentName}
                size="sm"
            />

            <div className="flex-1 min-w-0">
                {editing ? (
                    <input
                        ref={inputRef}
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleRenameSubmit}
                        onKeyDown={handleKeyDown}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full bg-transparent text-sm font-medium text-foreground outline-none border-b border-primary pb-0.5"
                    />
                ) : (
                    <span className="block text-sm font-medium truncate">
                        {displayName}
                    </span>
                )}
                <span className="block text-xs text-muted-foreground truncate mt-0.5">
                    {session.messageCount > 0
                        ? `${session.messageCount} messages`
                        : "No messages"
                    }
                    {relativeTime && ` -- ${relativeTime}`}
                </span>
            </div>

            <span
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                    e.stopPropagation();
                    onArchive(session.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted-foreground/10 transition-opacity shrink-0"
                title="Archive conversation"
            >
                <Trash size={14} className="text-muted-foreground" />
            </span>
        </button>
    );
}

export function ChatSessionSidebar() {
    const dispatch = useAppDispatch();
    const agentsMap = useAppSelector(selectAllAgents);
    const sessions = useAppSelector(selectSortedUserSessions);
    const activeSessionId = useAppSelector(selectActiveSessionId);

    const handleSelectSession = useCallback(
        (sessionId: string) => {
            dispatch(setActiveSession(sessionId));
        },
        [dispatch],
    );

    const handleArchiveSession = useCallback(
        (sessionId: string) => {
            dispatch(archiveSession(sessionId));
        },
        [dispatch],
    );

    const handleRenameSession = useCallback(
        (sessionId: string, name: string) => {
            dispatch(updateSession({ sessionId, displayName: name }));
        },
        [dispatch],
    );

    const handleNewChat = useCallback(
        (agent: SerializedAgent) => {
            dispatch(createSession({ agentId: agent.id, kind: SessionKind.DIRECT }));
        },
        [dispatch],
    );

    return (
        <div className="flex flex-col h-full bg-card">
            {/* Header with New Chat button */}
            <div className="px-3 pt-3 pb-2">
                <AgentPicker onSelectAgent={handleNewChat} />
            </div>

            {/* Session list */}
            <div className="flex-1 overflow-y-auto px-2 pb-2">
                {sessions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full px-4 text-center">
                        <ChatCircle size={32} className="text-muted-foreground/50 mb-2" />
                        <p className="text-sm text-muted-foreground">
                            No conversations yet
                        </p>
                        <p className="text-xs text-muted-foreground/70 mt-1">
                            Click "New Chat" to start
                        </p>
                    </div>
                ) : (
                    <div className="space-y-0.5">
                        {sessions.map((session) => {
                            const agent = agentsMap[session.agentId];
                            return (
                                <SessionItem
                                    key={session.id}
                                    session={session}
                                    agentName={agent?.name ?? "Agent"}
                                    agentEmoji={agent?.avatarEmoji ?? ""}
                                    agentAvatarKey={agent?.avatarKey ?? ""}
                                    isActive={session.id === activeSessionId}
                                    onSelect={handleSelectSession}
                                    onArchive={handleArchiveSession}
                                    onRename={handleRenameSession}
                                />
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
