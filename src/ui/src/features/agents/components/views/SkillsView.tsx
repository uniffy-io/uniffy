import { useEffect, useMemo, useRef, useState } from "react";
import { CircleNotch, Plus, ClockCounterClockwise, PencilSimple, Lightning, Trash } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
    selectSkillSearch,
    setSkillSearch,
    selectSelectedAgentId,
    setSelectedAgent,
} from "@/features/agents/store/agentsUiSlice";
import { selectAllSkills, selectSkillsLoading } from "@/features/agents/store/agentSkillsSlice";
import { selectAllAgents } from "@/features/agents/store/agentsSlice";
import { deleteSkill, fetchSkills } from "@/features/agents/store/agentSkillsThunks";
import {
    createSkillDraft,
    discardSkillDraft,
    type SerializedSkillDraft,
} from "@/features/agents/store/agentSkillDraftsThunks";
import { SkillDraftEditorModal } from "@/features/agents/components/skills/SkillDraftEditorModal";
import { SkillVersionHistoryModal } from "@/features/agents/components/skills/SkillVersionHistoryModal";
import { SkillDraftsInbox } from "@/features/agents/components/skills/SkillDraftsInbox";
import { selectInboxCount } from "@/features/agents/store/agentSkillDraftsSlice";
import { fetchSkillDrafts } from "@/features/agents/store/agentSkillDraftsThunks";
import type { SerializedSkill } from "@/features/agents/store/agentSkillsThunks";
import { fetchAgents, updateAgent } from "@/features/agents/store/agentsThunks";
import { SkillSource } from "@uniffy/proto/agents/v1/skills_pb";

function getSourceLabel(source: number): string {
    switch (source) {
        case SkillSource.BUNDLED:
            return "Bundled";
        case SkillSource.ORGANIZATION:
            return "Organization";
        case SkillSource.PERSONAL:
            return "Personal";
        default:
            return "Unknown";
    }
}

export function SkillsView() {
    const dispatch = useAppDispatch();
    const skillSearch = useAppSelector(selectSkillSearch);
    const skillsMap = useAppSelector(selectAllSkills);
    const loading = useAppSelector(selectSkillsLoading);
    const agentsMap = useAppSelector(selectAllAgents);
    const selectedAgentId = useAppSelector(selectSelectedAgentId);

    const [editorDraft, setEditorDraft] = useState<SerializedSkillDraft | null>(null);
    const [creatingDraft, setCreatingDraft] = useState(false);
    const [historySkill, setHistorySkill] = useState<SerializedSkill | null>(null);
    const [deletingSkill, setDeletingSkill] = useState<SerializedSkill | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false);
    const [skillsTab, setSkillsTab] = useState<"active" | "drafts">("active");
    const editorSavedRef = useRef(false);

    const inboxCount = useAppSelector(selectInboxCount);

    const agents = useMemo(() => Object.values(agentsMap), [agentsMap]);
    const skills = useMemo(() => Object.values(skillsMap), [skillsMap]);
    const selectedAgent = useMemo(
        () => (selectedAgentId ? agentsMap[selectedAgentId] ?? null : null),
        [selectedAgentId, agentsMap]
    );

    useEffect(() => {
        dispatch(fetchSkills());
        dispatch(fetchAgents());
        dispatch(fetchSkillDrafts({ status: "pending" }));
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-select default or first agent when none is selected
    useEffect(() => {
        if (!selectedAgentId && agents.length > 0) {
            const defaultAgent = agents.find((a) => a.isDefault) ?? agents[0];
            dispatch(setSelectedAgent(defaultAgent.id));
        }
    }, [selectedAgentId, agents, dispatch]);

    const filteredSkills = useMemo(() => {
        if (!skillSearch.trim()) return skills;
        const query = skillSearch.toLowerCase();
        return skills.filter(
            (skill) =>
                skill.name.toLowerCase().includes(query) ||
                skill.displayName.toLowerCase().includes(query) ||
                skill.description.toLowerCase().includes(query)
        );
    }, [skillSearch, skills]);

    const enabledSkillIds = useMemo(
        () => new Set(selectedAgent?.enabledSkills ?? []),
        [selectedAgent]
    );

    const activeCount = skills.filter(
        (s) => s.alwaysActive || enabledSkillIds.has(s.id)
    ).length;

    const handleToggle = (skillId: string) => {
        if (!selectedAgent) return;
        const currentSkills = selectedAgent.enabledSkills;
        const updated = enabledSkillIds.has(skillId)
            ? currentSkills.filter((id) => id !== skillId)
            : [...currentSkills, skillId];
        dispatch(updateAgent({ agentId: selectedAgent.id, enabledSkills: updated }));
    };

    const agentOptions = useMemo(
        () =>
            agents.map((a) => ({
                value: a.id,
                label: `${a.name}${a.isDefault ? " (default)" : ""}`,
            })),
        [agents],
    );

    const handleNewSkill = async () => {
        if (creatingDraft) return;
        setCreatingDraft(true);
        try {
            const draft = await dispatch(
                createSkillDraft({ kind: "create", name: "", displayName: "", content: "" }),
            ).unwrap();
            editorSavedRef.current = false;
            setEditorDraft(draft);
        } finally {
            setCreatingDraft(false);
        }
    };

    // Manual edit: seed an edit draft from the skill's current fields and open the
    // shared editor. Saving routes through SaveSkillDraft, which gates the scope,
    // validates, and snapshots a new version.
    const handleEditSkill = async (skill: SerializedSkill) => {
        if (creatingDraft) return;
        setCreatingDraft(true);
        try {
            const draft = await dispatch(
                createSkillDraft({
                    kind: "edit",
                    targetSkillId: skill.id,
                    name: skill.name,
                    displayName: skill.displayName,
                    description: skill.description,
                    content: skill.content,
                    whenToUse: skill.whenToUse,
                    requiresTools: skill.requiresTools,
                    requiresContext: skill.requiresContext,
                    suggestedScope:
                        skill.source === SkillSource.ORGANIZATION ? "organization" : "personal",
                    suggestedAlwaysActive: skill.alwaysActive,
                }),
            ).unwrap();
            editorSavedRef.current = false;
            setEditorDraft(draft);
        } finally {
            setCreatingDraft(false);
        }
    };

    // Closing the editor without saving drops the seed draft so it never lingers
    // in the review inbox.
    const handleCloseEditor = () => {
        const draft = editorDraft;
        setEditorDraft(null);
        if (draft && !editorSavedRef.current) {
            dispatch(discardSkillDraft(draft.id));
        }
    };

    const handleConfirmDelete = async () => {
        if (!deletingSkill) return;
        setDeleteBusy(true);
        try {
            await dispatch(deleteSkill(deletingSkill.id)).unwrap();
            setDeletingSkill(null);
        } finally {
            setDeleteBusy(false);
        }
    };

    if (loading && skills.length === 0) {
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
                    Skills
                </h2>
                <p className="text-sm text-muted-foreground">
                    Manage agent skills and capabilities
                </p>

                <div className="mt-3 flex items-center gap-1 border-b border-border -mb-px">
                    <button
                        type="button"
                        onClick={() => setSkillsTab("active")}
                        className={cn(
                            "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                            skillsTab === "active"
                                ? "border-primary text-foreground"
                                : "border-transparent text-muted-foreground hover:text-foreground",
                        )}
                    >
                        Library
                    </button>
                    <button
                        type="button"
                        onClick={() => setSkillsTab("drafts")}
                        className={cn(
                            "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5",
                            skillsTab === "drafts"
                                ? "border-primary text-foreground"
                                : "border-transparent text-muted-foreground hover:text-foreground",
                        )}
                    >
                        Drafts
                        {inboxCount > 0 && (
                            <Badge className="bg-primary/10 text-primary border-transparent px-1.5 py-0">
                                {inboxCount}
                            </Badge>
                        )}
                    </button>
                </div>

                {skillsTab === "active" && (
                    <div className="mt-3 flex items-center gap-3">
                        <Select
                            value={selectedAgentId ?? undefined}
                            onChange={(val) => dispatch(setSelectedAgent(val))}
                            options={agentOptions}
                            placeholder="Select agent..."
                        />
                        <div className="flex-1 max-w-md">
                            <Input
                                value={skillSearch}
                                onChange={(e) =>
                                    dispatch(setSkillSearch(e.target.value))
                                }
                                placeholder="Search skills..."
                            />
                        </div>
                        <span className="text-sm text-muted-foreground">
                            {activeCount} active / {skills.length} total
                        </span>
                        <Button
                            size="sm"
                            onClick={handleNewSkill}
                            disabled={creatingDraft}
                            className="ml-auto"
                        >
                            <Plus size={16} className="mr-1" />
                            {creatingDraft ? "Opening..." : "New skill"}
                        </Button>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-6">
                {skillsTab === "drafts" ? (
                    <SkillDraftsInbox onSkillSaved={() => dispatch(fetchSkills())} />
                ) : (
                <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredSkills.map((skill) => {
                        const isActive = skill.alwaysActive || enabledSkillIds.has(skill.id);
                        return (
                            <div
                                key={skill.id}
                                className="bg-card border border-border rounded-lg overflow-hidden"
                            >
                                <div className="px-4 py-3 flex items-center gap-3">
                                    <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center text-primary">
                                        <Lightning size={18} weight="fill" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate text-foreground">
                                            {skill.displayName}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {getSourceLabel(skill.source)}
                                        </p>
                                    </div>
                                    {isActive ? (
                                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-transparent">
                                            active
                                        </Badge>
                                    ) : (
                                        <Badge variant="secondary">
                                            inactive
                                        </Badge>
                                    )}
                                </div>

                                <div className="px-4 py-3">
                                    <p
                                        className={cn(
                                            "text-sm line-clamp-2 min-h-10",
                                            skill.description
                                                ? "text-muted-foreground"
                                                : "text-muted-foreground/60 italic"
                                        )}
                                    >
                                        {skill.description || "No description provided"}
                                    </p>
                                </div>

                                <div className="px-4 py-2 border-t border-border flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        {skill.alwaysActive && (
                                            <Badge variant="outline">
                                                Always loaded
                                            </Badge>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => setHistorySkill(skill)}
                                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                            <ClockCounterClockwise size={14} />
                                            v{skill.activeVersionNumber || 1}
                                        </button>
                                        {skill.source !== SkillSource.BUNDLED && (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={() => handleEditSkill(skill)}
                                                    disabled={creatingDraft}
                                                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                                                >
                                                    <PencilSimple size={14} />
                                                    Edit
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setDeletingSkill(skill)}
                                                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-red-500 transition-colors"
                                                >
                                                    <Trash size={14} />
                                                    Delete
                                                </button>
                                            </>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={isActive}
                                        onClick={() => handleToggle(skill.id)}
                                        disabled={skill.alwaysActive}
                                        className={cn(
                                            "relative inline-flex shrink-0 w-9 h-5 rounded-full transition-colors",
                                            isActive
                                                ? "bg-green-500"
                                                : "bg-muted-foreground/30",
                                            skill.alwaysActive
                                                ? "cursor-not-allowed opacity-50"
                                                : "cursor-pointer"
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                "pointer-events-none absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform",
                                                isActive
                                                    ? "translate-x-4"
                                                    : "translate-x-0"
                                            )}
                                        />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {filteredSkills.length === 0 && !loading && (
                    <div className="flex items-center justify-center py-12">
                        <p className="text-muted-foreground">No skills found</p>
                    </div>
                )}
                </>
                )}
            </div>

            {editorDraft && (
                <SkillDraftEditorModal
                    draft={editorDraft}
                    onClose={handleCloseEditor}
                    onSaved={() => {
                        editorSavedRef.current = true;
                        dispatch(fetchSkills());
                    }}
                />
            )}

            {historySkill && (
                <SkillVersionHistoryModal
                    skill={historySkill}
                    onClose={() => setHistorySkill(null)}
                />
            )}

            <ConfirmDialog
                isOpen={deletingSkill !== null}
                onClose={() => setDeletingSkill(null)}
                onConfirm={handleConfirmDelete}
                title="Delete skill"
                message={
                    <>
                        Delete <span className="font-medium text-foreground">{deletingSkill?.displayName}</span>?
                        This removes the skill and all its versions, and unenrolls it from every agent. This cannot be undone.
                    </>
                }
                confirmLabel="Delete"
                variant="danger"
                loading={deleteBusy}
            />
        </div>
    );
}
