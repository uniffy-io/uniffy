import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
    Notebook,
    Plus,
    Trash,
    CircleNotch,
    MagnifyingGlass,
    Package,
    Buildings,
    UsersThree,
    LockSimple,
    PencilSimple,
    FloppyDisk,
    X,
    CaretDown,
    CaretRight,
    Copy,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { loadPanelLayout, savePanelLayout } from "@/shared/utils/panelStorage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    selectAllPrompts,
    selectPromptsLoading,
} from "@/features/agents/store/agentPromptsSlice";
import {
    fetchPrompts,
    createPrompt,
    updatePrompt,
    deletePrompt,
} from "@/features/agents/store/agentPromptsThunks";
import type { SerializedPrompt } from "@/features/agents/store/agentPromptsThunks";
import { PromptSource } from "@uniffy/proto/agents/v1/prompts_pb";
import { ContentType, VisibilityScope } from "@uniffy/proto/common/v1/common_pb";
import { ShareButton } from "@/features/sharing";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CrepeEditor } from "@/components/editor/CrepeEditor";

function getSourceLabel(source: number): string {
    switch (source) {
        case PromptSource.BUNDLED:
            return "Bundled";
        case PromptSource.ORGANIZATION:
            return "Organization";
        case PromptSource.PERSONAL:
            return "Personal";
        default:
            return "Unknown";
    }
}

function getSourceIcon(source: number): Icon {
    switch (source) {
        case PromptSource.BUNDLED:
            return Package;
        case PromptSource.ORGANIZATION:
            return Buildings;
        case PromptSource.PERSONAL:
            return LockSimple;
        default:
            return Notebook;
    }
}

interface PromptSectionConfig {
    id: "bundled" | "personal" | "shared" | "organization";
    name: string;
    icon: Icon;
}

const SIDEBAR_SECTIONS: PromptSectionConfig[] = [
    { id: "bundled", name: "Bundled", icon: Package },
    { id: "personal", name: "My Prompts", icon: LockSimple },
    { id: "shared", name: "Shared With Me", icon: UsersThree },
    { id: "organization", name: "Organization", icon: Buildings },
];

const VISIBILITY_ICON: Record<number, Icon> = {
    [VisibilityScope.PRIVATE]: LockSimple,
    [VisibilityScope.GROUP]: UsersThree,
    [VisibilityScope.ORGANIZATION]: Buildings,
};

function PromptDetailPanel({
    prompt,
    onDelete,
    onClone,
    currentUserId,
}: {
    prompt: SerializedPrompt;
    onDelete: () => void;
    onClone: () => void;
    currentUserId: string | undefined;
}) {
    const dispatch = useAppDispatch();
    const isBundled = prompt.source === PromptSource.BUNDLED;
    const isOwner = prompt.createdBy === currentUserId;
    const canEdit = !isBundled && isOwner;
    const isPersonal = prompt.visibility === VisibilityScope.PRIVATE;
    const canMoveToOrg = canEdit && isPersonal;

    const [editing, setEditing] = useState(false);
    const [displayName, setDisplayName] = useState(prompt.displayName);
    const [description, setDescription] = useState(prompt.description);
    const [content, setContent] = useState(prompt.content);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setDisplayName(prompt.displayName);
        setDescription(prompt.description);
        setContent(prompt.content);
        setEditing(false);
    }, [prompt.id, prompt.displayName, prompt.description, prompt.content]);

    const [showMoveToOrgConfirm, setShowMoveToOrgConfirm] = useState(false);
    const [moving, setMoving] = useState(false);

    const hasChanges =
        displayName !== prompt.displayName ||
        description !== prompt.description ||
        content !== prompt.content;

    const handleMoveToOrgConfirm = async () => {
        if (moving) return;
        setMoving(true);
        try {
            await dispatch(
                updatePrompt({ promptId: prompt.id, visibility: VisibilityScope.ORGANIZATION })
            ).unwrap();
            setShowMoveToOrgConfirm(false);
        } finally {
            setMoving(false);
        }
    };

    const handleSave = async () => {
        if (!hasChanges) return;
        setSaving(true);
        try {
            await dispatch(
                updatePrompt({
                    promptId: prompt.id,
                    displayName,
                    description,
                    content,
                })
            ).unwrap();
            setEditing(false);
        } finally {
            setSaving(false);
        }
    };

    const handleCancel = () => {
        setDisplayName(prompt.displayName);
        setDescription(prompt.description);
        setContent(prompt.content);
        setEditing(false);
    };

    const SourceIcon = getSourceIcon(prompt.source);

    return (
        <>
            <div className="px-6 py-4 border-b border-border">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Notebook size={20} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h2 className="text-xl font-semibold text-foreground truncate">
                            {prompt.displayName}
                        </h2>
                        <div className="flex items-center gap-2 mt-0.5">
                            <SourceIcon size={14} className="text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">
                                {getSourceLabel(prompt.source)}
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        {canEdit && !editing && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setEditing(true)}
                                title="Edit"
                            >
                                <PencilSimple size={18} />
                            </Button>
                        )}
                        {editing && (
                            <>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={handleCancel}
                                    title="Cancel"
                                >
                                    <X size={18} />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={handleSave}
                                    disabled={!hasChanges || saving}
                                    title="Save"
                                >
                                    {saving ? (
                                        <CircleNotch size={18} className="animate-spin" />
                                    ) : (
                                        <FloppyDisk size={18} />
                                    )}
                                </Button>
                            </>
                        )}
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onClone}
                            title="Clone as personal copy"
                        >
                            <Copy size={18} />
                        </Button>
                        {canMoveToOrg && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setShowMoveToOrgConfirm(true)}
                                title="Move to Organization"
                            >
                                <Buildings size={18} />
                            </Button>
                        )}
                        {!isBundled && prompt.visibility === VisibilityScope.PRIVATE && isOwner && (
                            <ShareButton
                                contentType={ContentType.PROMPT}
                                contentId={prompt.id}
                                contentTitle={prompt.displayName}
                                iconOnly
                            />
                        )}
                        {canEdit && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={onDelete}
                                title="Delete"
                                className="text-muted-foreground hover:text-red-500"
                            >
                                <Trash size={18} />
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1">
                            Name
                        </label>
                        {editing ? (
                            <Input
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                            />
                        ) : (
                            <p className="text-sm text-foreground">{prompt.displayName}</p>
                        )}
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1">
                            Description
                        </label>
                        {editing ? (
                            <Input
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                            />
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                {prompt.description || "No description"}
                            </p>
                        )}
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-1">
                        Content
                    </label>
                    <div className="border border-border rounded-lg overflow-hidden bg-muted">
                        <CrepeEditor
                            contentType={ContentType.PROMPT}
                            contentId={prompt.id}
                            value={editing ? content : prompt.content}
                            onChange={editing ? setContent : undefined}
                            readonly={!editing}
                            enableUpload={false}
                            compact
                            minHeight="200px"
                            placeholder="Prompt content (markdown)..."
                        />
                    </div>
                    <div className="flex justify-end mt-1">
                        <span className="text-xs text-muted-foreground">
                            {(editing ? content : prompt.content).length.toLocaleString()} chars
                        </span>
                    </div>
                </div>
            </div>

            <ConfirmDialog
                isOpen={showMoveToOrgConfirm}
                onClose={() => setShowMoveToOrgConfirm(false)}
                onConfirm={handleMoveToOrgConfirm}
                title="Move to Organization"
                message="Moving this prompt to Organization will make it visible to all organization members. This action cannot be undone."
                confirmLabel="Move to Organization"
                cancelLabel="Cancel"
                variant="warning"
                loading={moving}
            />
        </>
    );
}

function CreatePromptForm({ onDone }: { onDone: (id?: string) => void }) {
    const dispatch = useAppDispatch();
    const [displayName, setDisplayName] = useState("");
    const [description, setDescription] = useState("");
    const [content, setContent] = useState("");
    const [visibility, setVisibility] = useState<number>(VisibilityScope.PRIVATE);
    const [submitting, setSubmitting] = useState(false);

    const canSubmit = displayName.trim() && content.trim() && !submitting;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;
        setSubmitting(true);
        try {
            const result = await dispatch(
                createPrompt({
                    displayName: displayName.trim(),
                    description: description.trim(),
                    content: content.trim(),
                    visibility,
                })
            ).unwrap();
            onDone(result.id);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <>
            <div className="px-6 py-4 border-b border-border">
                <h2 className="text-xl font-semibold text-foreground">Create Prompt</h2>
                <p className="text-sm text-muted-foreground">
                    Create a new prompt template for your agents
                </p>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
                <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
                    <div>
                        <label className="block text-sm text-muted-foreground mb-1">
                            Name
                        </label>
                        <Input
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            placeholder="e.g. Customer Support Agent"
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-muted-foreground mb-1">
                            Description
                        </label>
                        <Input
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="What this prompt does..."
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-muted-foreground mb-1">
                            Visibility
                        </label>
                        <div className="space-y-1.5">
                            {([
                                { value: VisibilityScope.PRIVATE, label: "Private", desc: "Only you can use this prompt", icon: LockSimple },
                                { value: VisibilityScope.ORGANIZATION, label: "Organization", desc: "All organization members", icon: Buildings },
                            ] as const).map((opt) => {
                                const Icon = opt.icon;
                                const isActive = visibility === opt.value;
                                return (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() => setVisibility(opt.value)}
                                        className={cn(
                                            "w-full px-3 py-2 rounded-lg border text-left text-sm transition-colors flex items-center gap-3",
                                            isActive
                                                ? "bg-primary/10 border-primary text-foreground"
                                                : "bg-muted border-border text-muted-foreground hover:text-foreground",
                                        )}
                                    >
                                        <Icon size={16} weight={isActive ? "fill" : "regular"} />
                                        <div>
                                            <span className="font-medium">{opt.label}</span>
                                            <span className="block text-xs text-muted-foreground">{opt.desc}</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm text-muted-foreground mb-1">
                            Content
                        </label>
                        <div className="border border-border rounded-lg overflow-hidden bg-muted">
                            <CrepeEditor
                                contentType={ContentType.PROMPT}
                                contentId=""
                                value={content}
                                onChange={setContent}
                                enableUpload={false}
                                compact
                                minHeight="180px"
                                placeholder="Enter the prompt instructions (markdown supported)..."
                            />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => onDone()}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!canSubmit}>
                            {submitting ? (
                                <CircleNotch size={16} className="animate-spin" />
                            ) : (
                                <Plus size={16} />
                            )}
                            Create Prompt
                        </Button>
                    </div>
                </form>
            </div>
        </>
    );
}

export function PromptsView() {
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const { subId } = useParams<{ subId?: string }>();
    const promptsMap = useAppSelector(selectAllPrompts);
    const loading = useAppSelector(selectPromptsLoading);
    const currentUserId = useAppSelector((state) => state.auth.user?.id);

    const [search, setSearch] = useState("");
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

    const selectedPromptId = subId ?? null;
    const selectPrompt = useCallback(
        (id: string | null) => {
            navigate(id ? `/agents/prompts/${id}` : "/agents/prompts", { replace: !id });
        },
        [navigate],
    );

    const prompts = useMemo(() => Object.values(promptsMap), [promptsMap]);

    const filteredPrompts = useMemo(() => {
        if (!search.trim()) return prompts;
        const query = search.toLowerCase();
        return prompts.filter(
            (p) =>
                p.displayName.toLowerCase().includes(query) ||
                p.name.toLowerCase().includes(query) ||
                p.description.toLowerCase().includes(query)
        );
    }, [search, prompts]);

    const promptsBySection = useMemo(() => {
        const result: Record<string, SerializedPrompt[]> = {
            bundled: [],
            personal: [],
            shared: [],
            organization: [],
        };
        for (const prompt of filteredPrompts) {
            if (prompt.source === PromptSource.BUNDLED) {
                result.bundled.push(prompt);
            } else if (prompt.visibility === VisibilityScope.ORGANIZATION) {
                result.organization.push(prompt);
            } else if (prompt.createdBy === currentUserId) {
                result.personal.push(prompt);
            } else {
                result.shared.push(prompt);
            }
        }
        return result;
    }, [filteredPrompts, currentUserId]);

    const toggleSection = (sectionId: string) => {
        setCollapsedSections((prev) => ({
            ...prev,
            [sectionId]: !prev[sectionId],
        }));
    };

    const selectedPrompt = useMemo(
        () => (selectedPromptId ? promptsMap[selectedPromptId] ?? null : null),
        [selectedPromptId, promptsMap],
    );

    useEffect(() => {
        dispatch(fetchPrompts());
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleDelete = async (promptId: string) => {
        await dispatch(deletePrompt(promptId)).unwrap();
        if (selectedPromptId === promptId) {
            selectPrompt(null);
        }
    };

    const handleClone = useCallback(
        async (prompt: SerializedPrompt) => {
            const result = await dispatch(
                createPrompt({
                    displayName: `${prompt.displayName} (Copy)`,
                    description: prompt.description,
                    content: prompt.content,
                    visibility: VisibilityScope.PRIVATE,
                })
            ).unwrap();
            selectPrompt(result.id);
        },
        [dispatch, selectPrompt],
    );

    const handleCreated = (newId?: string) => {
        setShowCreateForm(false);
        if (newId) {
            selectPrompt(newId);
        }
    };

    const [defaultLayout] = useState(() => loadPanelLayout("agents-prompts"));

    const handleLayoutChange = useCallback(
        (layout: Record<string, number>) => {
            savePanelLayout("agents-prompts", layout);
        },
        [],
    );

    if (loading && prompts.length === 0) {
        return (
            <div className="flex h-full items-center justify-center">
                <CircleNotch size={32} className="animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="flex h-full overflow-hidden">
            <Group
                orientation="horizontal"
                className="h-full w-full flex"
                defaultLayout={defaultLayout}
                onLayoutChange={handleLayoutChange}
            >
                <Panel
                    id="prompts-sidebar"
                    defaultSize={260}
                    minSize={200}
                    maxSize={400}
                    className="border-r border-border bg-card overflow-hidden"
                >
                    <div className="h-full flex flex-col">
                        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                            <span className="font-semibold text-foreground">Prompts</span>
                            <Button
                                variant="ghost"
                                size="icon"
                                className={showCreateForm ? "text-primary bg-primary/10" : ""}
                                onClick={() => setShowCreateForm(!showCreateForm)}
                            >
                                <Plus size={16} />
                            </Button>
                        </div>

                        <div className="px-3 py-2">
                            <div className="relative">
                                <MagnifyingGlass
                                    size={14}
                                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                                />
                                <Input
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Search prompts..."
                                    className="pl-8 h-8 text-sm"
                                />
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto">
                            {SIDEBAR_SECTIONS.map((section) => {
                                const sectionPrompts = promptsBySection[section.id] || [];
                                const isCollapsed = collapsedSections[section.id];
                                const SectionIcon = section.icon;

                                return (
                                    <div key={section.id}>
                                        <button
                                            type="button"
                                            onClick={() => toggleSection(section.id)}
                                            className="w-full px-4 py-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                            {isCollapsed ? <CaretRight size={12} /> : <CaretDown size={12} />}
                                            <SectionIcon size={14} />
                                            <span className="flex-1 text-left">{section.name}</span>
                                            <span className="text-muted-foreground">{sectionPrompts.length}</span>
                                        </button>
                                        {!isCollapsed && sectionPrompts.map((prompt) => {
                                            const isSelected = prompt.id === selectedPromptId;
                                            const VisIcon = VISIBILITY_ICON[prompt.visibility] || LockSimple;

                                            return (
                                                <button
                                                    key={prompt.id}
                                                    type="button"
                                                    onClick={() => {
                                                        selectPrompt(prompt.id);
                                                        setShowCreateForm(false);
                                                    }}
                                                    className={cn(
                                                        "w-full px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors text-left",
                                                        isSelected
                                                            ? "bg-primary/10 border-l-2 border-primary"
                                                            : "hover:bg-muted border-l-2 border-transparent",
                                                    )}
                                                >
                                                    <Notebook size={18} className="text-muted-foreground shrink-0" />
                                                    <div className="flex flex-col flex-1 min-w-0">
                                                        <span className="text-sm font-medium truncate text-foreground">
                                                            {prompt.displayName}
                                                        </span>
                                                        <span className="text-xs text-muted-foreground truncate">
                                                            {prompt.description || "No description"}
                                                        </span>
                                                    </div>
                                                    {section.id !== "bundled" && (
                                                        <VisIcon size={14} className="text-muted-foreground shrink-0" />
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                            {filteredPrompts.length === 0 && !loading && (
                                <div className="flex items-center justify-center py-12">
                                    <p className="text-sm text-muted-foreground">
                                        {search ? "No prompts match your search" : "No prompts yet"}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </Panel>

                <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />

                <Panel id="prompts-detail" minSize={400}>
                    <div className="h-full flex flex-col overflow-hidden">
                        {showCreateForm ? (
                            <CreatePromptForm onDone={handleCreated} />
                        ) : selectedPrompt ? (
                            <PromptDetailPanel
                                prompt={selectedPrompt}
                                onDelete={() => handleDelete(selectedPrompt.id)}
                                onClone={() => handleClone(selectedPrompt)}
                                currentUserId={currentUserId}
                            />
                        ) : (
                            <div className="flex-1 flex items-center justify-center">
                                <div className="text-center">
                                    <Notebook size={32} className="text-muted-foreground mx-auto mb-2" />
                                    <p className="text-muted-foreground">
                                        {prompts.length > 0
                                            ? "Select a prompt from the sidebar"
                                            : "No prompts configured"}
                                    </p>
                                    {prompts.length === 0 && (
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            className="mt-3"
                                            onClick={() => setShowCreateForm(true)}
                                        >
                                            <Plus size={14} />
                                            Create Prompt
                                        </Button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </Panel>
            </Group>
        </div>
    );
}
