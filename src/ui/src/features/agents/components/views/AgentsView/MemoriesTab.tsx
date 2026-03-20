import { useEffect, useMemo, useState, useCallback } from "react";
import {
    CircleNotch,
    PencilSimple,
    Trash,
    FloppyDisk,
    X,
    Brain,
    MagnifyingGlass,
    Plus,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";
import {
    selectAllMemories,
    selectMemoriesLoading,
} from "@/features/agents/store/agentMemoriesSlice";
import {
    fetchMemories,
    createMemory,
    updateMemory,
    deleteMemory,
} from "@/features/agents/store/agentMemoriesThunks";
import type { SerializedMemory } from "@/features/agents/store/agentMemoriesThunks";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";
import { MemoryCategory } from "@uniffy/proto/agents/v1/memories_pb";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<number, string> = {
    [MemoryCategory.UNSPECIFIED]: "Unspecified",
    [MemoryCategory.PREFERENCES]: "Preferences",
    [MemoryCategory.FACTS]: "Facts",
    [MemoryCategory.CONTEXT]: "Context",
    [MemoryCategory.INSTRUCTIONS]: "Instructions",
};

const CATEGORY_BADGE_CLASSES: Record<number, string> = {
    [MemoryCategory.PREFERENCES]:
        "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-transparent",
    [MemoryCategory.FACTS]:
        "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-transparent",
    [MemoryCategory.CONTEXT]:
        "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 border-transparent",
    [MemoryCategory.INSTRUCTIONS]:
        "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border-transparent",
};

const CATEGORY_FILTER_OPTIONS = [
    { value: "all", label: "All categories" },
    { value: String(MemoryCategory.PREFERENCES), label: "Preferences" },
    { value: String(MemoryCategory.FACTS), label: "Facts" },
    { value: String(MemoryCategory.CONTEXT), label: "Context" },
    { value: String(MemoryCategory.INSTRUCTIONS), label: "Instructions" },
];

const CATEGORY_EDIT_OPTIONS = [
    { value: String(MemoryCategory.PREFERENCES), label: "Preferences" },
    { value: String(MemoryCategory.FACTS), label: "Facts" },
    { value: String(MemoryCategory.CONTEXT), label: "Context" },
    { value: String(MemoryCategory.INSTRUCTIONS), label: "Instructions" },
];

function getCategoryBadgeClass(category: number): string {
    return (
        CATEGORY_BADGE_CLASSES[category] ??
        "bg-muted text-muted-foreground border-transparent"
    );
}

function formatTimestamp(ts?: { seconds: number; nanos: number }): string {
    if (!ts) return "";
    const date = new Date(ts.seconds * 1000);
    return formatRelativeTime(date.toISOString());
}

// ---------------------------------------------------------------------------
// Importance bar
// ---------------------------------------------------------------------------

function ImportanceBar({ value }: { value: number }) {
    const segments = 10;
    const filled = Math.round(value * segments);

    return (
        <div className="flex items-center gap-0.5" title={`Importance: ${value.toFixed(1)}`}>
            {Array.from({ length: segments }, (_, i) => (
                <div
                    key={i}
                    className={cn(
                        "w-1.5 h-3 rounded-sm",
                        i < filled ? "bg-primary" : "bg-muted"
                    )}
                />
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Edit form
// ---------------------------------------------------------------------------

interface EditState {
    content: string;
    category: number;
    importance: number;
}

function MemoryEditForm({
    memory,
    onSave,
    onCancel,
}: {
    memory: SerializedMemory;
    onSave: (data: EditState) => void;
    onCancel: () => void;
}) {
    const [form, setForm] = useState<EditState>({
        content: memory.content,
        category: memory.category,
        importance: memory.importance,
    });

    return (
        <div className="space-y-3 p-3 bg-muted/50 rounded-md border border-border">
            <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Content
                </label>
                <textarea
                    value={form.content}
                    onChange={(e) => setForm((prev) => ({ ...prev, content: e.target.value }))}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground resize-y min-h-[60px] focus:outline-none focus:ring-1 focus:ring-ring"
                    rows={3}
                />
            </div>

            <div className="flex items-center gap-4">
                <div className="flex-1">
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                        Category
                    </label>
                    <Select
                        value={String(form.category)}
                        onChange={(val) =>
                            setForm((prev) => ({ ...prev, category: Number(val) }))
                        }
                        options={CATEGORY_EDIT_OPTIONS}
                    />
                </div>
                <div className="flex-1">
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                        Importance ({form.importance.toFixed(1)})
                    </label>
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.1}
                        value={form.importance}
                        onChange={(e) =>
                            setForm((prev) => ({
                                ...prev,
                                importance: parseFloat(e.target.value),
                            }))
                        }
                        className="w-full accent-primary"
                    />
                </div>
            </div>

            <div className="flex items-center gap-2 justify-end">
                <Button variant="secondary" size="sm" onClick={onCancel}>
                    <X size={14} />
                    Cancel
                </Button>
                <Button size="sm" onClick={() => onSave(form)}>
                    <FloppyDisk size={14} />
                    Save
                </Button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// New memory form
// ---------------------------------------------------------------------------

interface NewMemoryState {
    key: string;
    content: string;
    category: number;
    importance: number;
}

const INITIAL_NEW_MEMORY: NewMemoryState = {
    key: "",
    content: "",
    category: MemoryCategory.FACTS,
    importance: 0.5,
};

function NewMemoryForm({
    onSubmit,
    onCancel,
}: {
    onSubmit: (data: NewMemoryState) => void;
    onCancel: () => void;
}) {
    const [form, setForm] = useState<NewMemoryState>(INITIAL_NEW_MEMORY);
    const [submitting, setSubmitting] = useState(false);

    const canSubmit = form.key.trim() && form.content.trim() && !submitting;

    const handleSubmit = () => {
        if (!canSubmit) return;
        setSubmitting(true);
        onSubmit(form);
        setSubmitting(false);
    };

    return (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-muted/30 flex items-center gap-2">
                <Plus size={16} className="text-primary" />
                <span className="text-sm font-medium text-foreground">Add Memory</span>
            </div>
            <div className="p-4 space-y-3">
                <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                        Key
                    </label>
                    <input
                        type="text"
                        value={form.key}
                        onChange={(e) => setForm((prev) => ({ ...prev, key: e.target.value }))}
                        placeholder="Short descriptive key (e.g. preferred_format, project_deadline)"
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        onKeyDown={(e) => {
                            if (e.key === "Escape") onCancel();
                        }}
                        autoFocus
                    />
                </div>
                <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                        Content
                    </label>
                    <textarea
                        value={form.content}
                        onChange={(e) => setForm((prev) => ({ ...prev, content: e.target.value }))}
                        placeholder="What should the agent remember?"
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-y min-h-[60px] focus:outline-none focus:ring-1 focus:ring-ring"
                        rows={3}
                    />
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex-1">
                        <label className="text-xs font-medium text-muted-foreground mb-1 block">
                            Category
                        </label>
                        <Select
                            value={String(form.category)}
                            onChange={(val) =>
                                setForm((prev) => ({ ...prev, category: Number(val) }))
                            }
                            options={CATEGORY_EDIT_OPTIONS}
                        />
                    </div>
                    <div className="flex-1">
                        <label className="text-xs font-medium text-muted-foreground mb-1 block">
                            Importance ({form.importance.toFixed(1)})
                        </label>
                        <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.1}
                            value={form.importance}
                            onChange={(e) =>
                                setForm((prev) => ({
                                    ...prev,
                                    importance: parseFloat(e.target.value),
                                }))
                            }
                            className="w-full accent-primary"
                        />
                    </div>
                </div>
                <div className="flex items-center gap-2 justify-end">
                    <Button variant="secondary" size="sm" onClick={onCancel}>
                        <X size={14} />
                        Cancel
                    </Button>
                    <Button size="sm" onClick={handleSubmit} disabled={!canSubmit}>
                        <Plus size={14} />
                        Add Memory
                    </Button>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Memory row
// ---------------------------------------------------------------------------

function MemoryRow({
    memory,
    onEdit,
    onDelete,
    isEditing,
    onSave,
    onCancel,
}: {
    memory: SerializedMemory;
    onEdit: () => void;
    onDelete: () => void;
    isEditing: boolean;
    onSave: (data: EditState) => void;
    onCancel: () => void;
}) {
    const [confirmDelete, setConfirmDelete] = useState(false);

    const handleDelete = () => {
        if (confirmDelete) {
            onDelete();
            setConfirmDelete(false);
        } else {
            setConfirmDelete(true);
        }
    };

    return (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 flex items-start gap-3">
                <Badge className={cn("shrink-0 mt-0.5", getCategoryBadgeClass(memory.category))}>
                    {CATEGORY_LABELS[memory.category] ?? "Unknown"}
                </Badge>

                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                        {memory.key}
                    </p>
                    {!isEditing && (
                        <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap break-words">
                            {memory.content}
                        </p>
                    )}
                </div>

                {!isEditing && (
                    <div className="flex items-center gap-1 shrink-0">
                        <button
                            type="button"
                            onClick={onEdit}
                            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            title="Edit memory"
                        >
                            <PencilSimple size={16} />
                        </button>
                        <button
                            type="button"
                            onClick={handleDelete}
                            onBlur={() => setConfirmDelete(false)}
                            className={cn(
                                "p-1.5 rounded-md transition-colors cursor-pointer",
                                confirmDelete
                                    ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                                    : "hover:bg-muted text-muted-foreground hover:text-foreground"
                            )}
                            title={confirmDelete ? "Click again to confirm" : "Delete memory"}
                        >
                            <Trash size={16} />
                        </button>
                    </div>
                )}
            </div>

            {isEditing && (
                <div className="px-4 pb-3">
                    <MemoryEditForm
                        memory={memory}
                        onSave={onSave}
                        onCancel={onCancel}
                    />
                </div>
            )}

            {!isEditing && (
                <div className="px-4 py-2 border-t border-border flex items-center gap-4 text-xs text-muted-foreground">
                    <ImportanceBar value={memory.importance} />
                    <span>Accessed {memory.accessCount}x</span>
                    <span className="ml-auto">
                        {formatTimestamp(memory.updatedAt)}
                    </span>
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main tab component
// ---------------------------------------------------------------------------

export function MemoriesTab({ agent }: { agent: SerializedAgent }) {
    const dispatch = useAppDispatch();
    const memoriesMap = useAppSelector(selectAllMemories);
    const loading = useAppSelector(selectMemoriesLoading);

    const [search, setSearch] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("all");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [showCreateForm, setShowCreateForm] = useState(false);

    const memories = useMemo(() => Object.values(memoriesMap), [memoriesMap]);

    // Fetch memories when agent or filters change
    useEffect(() => {
        dispatch(
            fetchMemories({
                agentId: agent.id,
                category:
                    categoryFilter !== "all" ? Number(categoryFilter) : undefined,
                search: search.trim() || undefined,
            })
        );
    }, [dispatch, agent.id, categoryFilter, search]);

    const filteredMemories = useMemo(() => {
        let result = memories;

        if (search.trim()) {
            const query = search.toLowerCase();
            result = result.filter(
                (m) =>
                    m.key.toLowerCase().includes(query) ||
                    m.content.toLowerCase().includes(query)
            );
        }

        return result.sort((a, b) => {
            if (b.importance !== a.importance) return b.importance - a.importance;
            const aTime = a.updatedAt?.seconds ?? 0;
            const bTime = b.updatedAt?.seconds ?? 0;
            return bTime - aTime;
        });
    }, [memories, search]);

    const handleCreate = useCallback(
        (data: NewMemoryState) => {
            dispatch(
                createMemory({
                    agentId: agent.id,
                    key: data.key,
                    content: data.content,
                    category: data.category,
                    importance: data.importance,
                })
            );
            setShowCreateForm(false);
        },
        [dispatch, agent.id]
    );

    const handleSave = useCallback(
        (memoryId: string, data: EditState) => {
            dispatch(
                updateMemory({
                    memoryId,
                    content: data.content,
                    category: data.category,
                    importance: data.importance,
                })
            );
            setEditingId(null);
        },
        [dispatch]
    );

    const handleDelete = useCallback(
        (memoryId: string) => {
            dispatch(deleteMemory(memoryId));
        },
        [dispatch]
    );

    if (loading && memories.length === 0) {
        return (
            <div className="flex items-center justify-center py-12">
                <CircleNotch size={24} className="animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div>
                <h3 className="font-medium text-foreground">Agent Memories</h3>
                <p className="text-sm text-muted-foreground mt-1">
                    View and manage what this agent remembers about you
                </p>
            </div>

            {/* Controls row */}
            <div className="flex items-center gap-3 flex-wrap">
                <div className="flex-1 max-w-sm relative">
                    <MagnifyingGlass
                        size={16}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search memories..."
                        className="pl-9"
                    />
                </div>
                <Select
                    value={categoryFilter}
                    onChange={(val) => setCategoryFilter(val)}
                    options={CATEGORY_FILTER_OPTIONS}
                />
                <span className="text-sm text-muted-foreground">
                    {filteredMemories.length} {filteredMemories.length === 1 ? "memory" : "memories"}
                </span>
                <button
                    type="button"
                    onClick={() => setShowCreateForm(!showCreateForm)}
                    className={cn(
                        "p-1.5 rounded-md transition-colors cursor-pointer",
                        showCreateForm
                            ? "text-primary bg-primary/10"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                    title="Add memory"
                >
                    <Plus size={18} />
                </button>
            </div>

            {/* Create form */}
            {showCreateForm && (
                <NewMemoryForm
                    onSubmit={handleCreate}
                    onCancel={() => setShowCreateForm(false)}
                />
            )}

            {/* Memory list */}
            <div className="space-y-3">
                {filteredMemories.map((memory) => (
                    <MemoryRow
                        key={memory.id}
                        memory={memory}
                        isEditing={editingId === memory.id}
                        onEdit={() => setEditingId(memory.id)}
                        onCancel={() => setEditingId(null)}
                        onSave={(data) => handleSave(memory.id, data)}
                        onDelete={() => handleDelete(memory.id)}
                    />
                ))}
            </div>

            {/* Empty state */}
            {filteredMemories.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                    <Brain
                        size={48}
                        weight="duotone"
                        className="text-muted-foreground/50 mb-4"
                    />
                    <p className="text-muted-foreground font-medium">
                        No memories found
                    </p>
                    <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">
                        This agent has not stored any memories yet. Memories are created automatically during conversations.
                    </p>
                </div>
            )}
        </div>
    );
}
