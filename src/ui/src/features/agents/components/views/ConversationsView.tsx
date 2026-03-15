import { useEffect, useMemo, useState } from "react";
import { Trash, CircleNotch, CaretDown, CaretRight, PencilSimple } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Table,
    TableHeader,
    TableBody,
    TableRow,
    TableHead,
    TableCell,
    TableEmpty,
} from "@/components/ui/table";
import {
    selectUserSessions,
    selectPromptBuilderSessions,
    selectSessionsLoading,
    PROMPT_BUILDER_PREFIX,
} from "@/features/agents/store/agentSessionsSlice";
import { selectAllAgents } from "@/features/agents/store/agentsSlice";
import { fetchSessions, archiveSession } from "@/features/agents/store/agentSessionsThunks";
import type { SerializedSession } from "@/features/agents/store/agentSessionsThunks";

function formatRelativeTime(ts?: { seconds: number; nanos: number }): string {
    if (!ts) return "N/A";
    const diff = Date.now() - ts.seconds * 1000;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function formatNumber(n: number): string {
    return n.toLocaleString();
}

function stripPromptBuilderPrefix(name: string): string {
    return name.startsWith(PROMPT_BUILDER_PREFIX)
        ? name.slice(PROMPT_BUILDER_PREFIX.length)
        : name;
}

function SessionsTable({
    sessions,
    onArchive,
}: {
    sessions: SerializedSession[];
    onArchive: (sessionId: string) => void;
}) {
    return (
        <Table rounded={false}>
            <TableHeader>
                <TableRow hoverable={false}>
                    <TableHead>Session</TableHead>
                    <TableHead>Last Active</TableHead>
                    <TableHead>Messages</TableHead>
                    <TableHead>Tokens</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Actions</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {sessions.map((session) => {
                    const totalTokens = session.totalInputTokens + session.totalOutputTokens;
                    return (
                        <TableRow key={session.id}>
                            <TableCell>
                                <div className="flex flex-col">
                                    <span className="text-sm font-medium text-foreground truncate max-w-50">
                                        {session.displayName || "Untitled"}
                                    </span>
                                </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                                {formatRelativeTime(session.updatedAt)}
                            </TableCell>
                            <TableCell>
                                {session.messageCount}
                            </TableCell>
                            <TableCell>
                                {formatNumber(totalTokens)}
                            </TableCell>
                            <TableCell>
                                <Badge variant="secondary" className="font-mono">
                                    {session.lastModelUsed || "N/A"}
                                </Badge>
                            </TableCell>
                            <TableCell>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => onArchive(session.id)}
                                    className="text-muted-foreground hover:text-red-500"
                                    aria-label={`Archive session ${session.id}`}
                                >
                                    <Trash size={16} />
                                </Button>
                            </TableCell>
                        </TableRow>
                    );
                })}
                {sessions.length === 0 && (
                    <TableEmpty
                        colSpan={6}
                        title="No conversations found"
                    />
                )}
            </TableBody>
        </Table>
    );
}

function PromptBuilderTable({
    sessions,
    agents,
    onArchive,
}: {
    sessions: SerializedSession[];
    agents: Record<string, { name: string; avatarEmoji: string }>;
    onArchive: (sessionId: string) => void;
}) {
    return (
        <Table rounded={false}>
            <TableHeader>
                <TableRow hoverable={false}>
                    <TableHead>Agent</TableHead>
                    <TableHead>Last Active</TableHead>
                    <TableHead>Messages</TableHead>
                    <TableHead>Tokens</TableHead>
                    <TableHead>Actions</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {sessions.map((session) => {
                    const agent = agents[session.agentId];
                    const totalTokens = session.totalInputTokens + session.totalOutputTokens;
                    return (
                        <TableRow key={session.id}>
                            <TableCell>
                                <div className="flex items-center gap-2">
                                    {agent?.avatarEmoji && (
                                        <span className="text-base">{agent.avatarEmoji}</span>
                                    )}
                                    <div className="flex flex-col">
                                        <span className="text-sm font-medium text-foreground truncate max-w-50">
                                            {agent?.name || stripPromptBuilderPrefix(session.displayName || "Untitled")}
                                        </span>
                                    </div>
                                </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                                {formatRelativeTime(session.updatedAt)}
                            </TableCell>
                            <TableCell>
                                {session.messageCount}
                            </TableCell>
                            <TableCell>
                                {formatNumber(totalTokens)}
                            </TableCell>
                            <TableCell>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => onArchive(session.id)}
                                    className="text-muted-foreground hover:text-red-500"
                                    aria-label={`Archive prompt builder session ${session.id}`}
                                >
                                    <Trash size={16} />
                                </Button>
                            </TableCell>
                        </TableRow>
                    );
                })}
                {sessions.length === 0 && (
                    <TableEmpty
                        colSpan={5}
                        title="No prompt builder sessions"
                    />
                )}
            </TableBody>
        </Table>
    );
}

export function ConversationsView() {
    const dispatch = useAppDispatch();
    const userSessionsMap = useAppSelector(selectUserSessions);
    const promptBuilderSessionsMap = useAppSelector(selectPromptBuilderSessions);
    const agents = useAppSelector(selectAllAgents);
    const loading = useAppSelector(selectSessionsLoading);
    const [includeGlobal, setIncludeGlobal] = useState(false);
    const [promptBuilderOpen, setPromptBuilderOpen] = useState(false);

    const userSessions = useMemo(() => Object.values(userSessionsMap), [userSessionsMap]);
    const promptBuilderSessions = useMemo(
        () => Object.values(promptBuilderSessionsMap).sort(
            (a, b) => (b.updatedAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? 0),
        ),
        [promptBuilderSessionsMap],
    );

    useEffect(() => {
        dispatch(fetchSessions());
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleArchive = (sessionId: string) => {
        dispatch(archiveSession(sessionId));
    };

    if (loading && userSessions.length === 0 && promptBuilderSessions.length === 0) {
        return (
            <div className="flex h-full items-center justify-center">
                <CircleNotch size={32} className="animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
                <h2 className="text-xl font-semibold text-foreground">
                    Conversations
                </h2>
                <p className="text-sm text-muted-foreground">
                    Active conversations and configuration
                </p>

                <div className="mt-3">
                    <Checkbox
                        checked={includeGlobal}
                        onChange={(e) => setIncludeGlobal(e.target.checked)}
                        label="Include global"
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                <SessionsTable
                    sessions={userSessions}
                    onArchive={handleArchive}
                />

                {/* Prompt Builder Sessions */}
                <div className="border-t border-border">
                    <button
                        type="button"
                        onClick={() => setPromptBuilderOpen((v) => !v)}
                        className="flex items-center gap-2 w-full px-6 py-3 text-left hover:bg-muted/50 transition-colors"
                    >
                        {promptBuilderOpen
                            ? <CaretDown size={14} className="text-muted-foreground" />
                            : <CaretRight size={14} className="text-muted-foreground" />
                        }
                        <PencilSimple size={16} className="text-muted-foreground" />
                        <span className="text-sm font-medium text-foreground">
                            Prompt Builder
                        </span>
                        <Badge variant="secondary" className="ml-1">
                            {promptBuilderSessions.length}
                        </Badge>
                    </button>
                    {promptBuilderOpen && (
                        <PromptBuilderTable
                            sessions={promptBuilderSessions}
                            agents={agents}
                            onArchive={handleArchive}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
