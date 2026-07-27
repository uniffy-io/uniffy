import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CircleNotch, Plus, Robot } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { AccessMode } from "@uniffy/proto/common/v1/common_pb";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { createAgent, updateAgent } from "@/features/agents/store/agentsThunks";
import { selectAllSkills } from "@/features/agents/store/agentSkillsSlice";
import { fetchSkills } from "@/features/agents/store/agentSkillsThunks";
import { selectAgentTemplates } from "@/features/agents/store/agentTemplatesSlice";
import { fetchAgentTemplates } from "@/features/agents/store/agentTemplatesThunks";

function CreateAgentModalContent({
    initialTemplateKey,
    onClose,
}: {
    initialTemplateKey: string | null;
    onClose: () => void;
}) {
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const skillsMap = useAppSelector(selectAllSkills);
    const templates = useAppSelector(selectAgentTemplates);

    const [selectedTemplateKey, setSelectedTemplateKey] = useState<string | null>(
        initialTemplateKey,
    );
    // Null means "follow the selected template"; typing pins an explicit name.
    const [nameOverride, setNameOverride] = useState<string | null>(null);
    const [accessMode, setAccessMode] = useState<AccessMode>(AccessMode.OWNER_ONLY);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        dispatch(fetchAgentTemplates());
        if (Object.keys(skillsMap).length === 0) {
            dispatch(fetchSkills());
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- one fetch per modal open; refetching on skillsMap updates would loop when the org has no skills
    }, []);

    const selectedTemplate = templates.find((t) => t.key === selectedTemplateKey) ?? null;
    const name = nameOverride ?? selectedTemplate?.name ?? "";

    const selectTemplate = (key: string | null) => {
        setSelectedTemplateKey(key);
        setNameOverride(key ? null : name);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || submitting) return;
        setSubmitting(true);
        try {
            const template = selectedTemplate;
            const result = await dispatch(
                createAgent({
                    name: name.trim(),
                    accessMode,
                    ...(template
                        ? {
                              soulPrompt: template.soulPrompt,
                              avatarEmoji: template.emoji,
                              enabledSkills: template.enabledSkillIds,
                          }
                        : {}),
                }),
            ).unwrap();
            if (template && template.enabledTools.length > 0) {
                // CreateAgentRequest carries no tools field; enable them right after creation, clone-style, without blocking navigation.
                dispatch(updateAgent({ agentId: result.id, enabledTools: template.enabledTools }));
            }
            navigate(`/agents/agents/${result.id}/overview`);
            onClose();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} data-testid="agents-create-form">
            <div className="px-6 py-4 border-b border-border">
                <h2 className="text-xl font-semibold text-foreground">New agent</h2>
                <p className="text-sm text-muted-foreground">
                    Start from a template or a blank agent.
                </p>
            </div>

            <div className="max-h-[65dvh] overflow-y-auto px-6 py-5 space-y-5">
                <div
                    className="grid grid-cols-1 sm:grid-cols-2 gap-2"
                    data-testid="agents-template-gallery"
                >
                    <button
                        type="button"
                        onClick={() => selectTemplate(null)}
                        data-testid="agents-template-card-blank"
                        data-selected={selectedTemplateKey === null}
                        className={cn(
                            "rounded-lg border p-3 text-left transition-colors",
                            selectedTemplateKey === null
                                ? "bg-primary/10 border-primary"
                                : "border-border hover:bg-muted",
                        )}
                    >
                        <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                                <Robot size={18} className="text-primary" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground">Blank</p>
                                <p className="text-xs text-muted-foreground truncate">
                                    Configure everything yourself.
                                </p>
                            </div>
                        </div>
                    </button>

                    {templates.map((template) => {
                        const isSelected = selectedTemplateKey === template.key;
                        return (
                            <button
                                key={template.key}
                                type="button"
                                onClick={() => selectTemplate(template.key)}
                                data-testid={`agents-template-card-${template.key}`}
                                data-selected={isSelected}
                                className={cn(
                                    "rounded-lg border p-3 text-left transition-colors",
                                    isSelected
                                        ? "bg-primary/10 border-primary"
                                        : "border-border hover:bg-muted",
                                )}
                            >
                                <div className="flex items-center gap-2.5">
                                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 text-base">
                                        {template.emoji}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-foreground">
                                            {template.name}
                                        </p>
                                        <p className="text-xs text-muted-foreground truncate">
                                            {template.description}
                                        </p>
                                    </div>
                                </div>
                                {template.enabledSkillIds.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-2">
                                        {template.enabledSkillIds.map((skillId) => (
                                            <Badge
                                                key={skillId}
                                                variant="secondary"
                                                className="text-xs"
                                            >
                                                {skillsMap[skillId]?.displayName ?? "Skill"}
                                            </Badge>
                                        ))}
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>

                <div>
                    <label className="block text-sm text-muted-foreground mb-1">Name</label>
                    <Input
                        value={name}
                        onChange={(e) => setNameOverride(e.target.value)}
                        placeholder="e.g. Research Assistant"
                        data-testid="agents-create-name-input"
                    />
                </div>

                <div>
                    <label className="block text-sm text-muted-foreground mb-1">Access</label>
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={() => setAccessMode(AccessMode.OWNER_ONLY)}
                            className={cn(
                                "rounded-lg border p-3 text-left transition-colors",
                                accessMode === AccessMode.OWNER_ONLY
                                    ? "bg-primary/10 border-primary"
                                    : "border-border hover:bg-muted",
                            )}
                        >
                            <p className="text-sm font-medium text-foreground">Private</p>
                            <p className="text-xs text-muted-foreground">
                                Only you can see and use this agent.
                            </p>
                        </button>
                        <button
                            type="button"
                            onClick={() => setAccessMode(AccessMode.OPEN_TO_ORG)}
                            className={cn(
                                "rounded-lg border p-3 text-left transition-colors",
                                accessMode === AccessMode.OPEN_TO_ORG
                                    ? "bg-primary/10 border-primary"
                                    : "border-border hover:bg-muted",
                            )}
                        >
                            <p className="text-sm font-medium text-foreground">Organization</p>
                            <p className="text-xs text-muted-foreground">
                                Everyone in your organization can use it.
                            </p>
                        </button>
                    </div>
                </div>
            </div>

            <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={onClose}>
                    Cancel
                </Button>
                <Button
                    type="submit"
                    disabled={!name.trim() || submitting}
                    data-testid="agents-create-submit"
                >
                    {submitting ? (
                        <CircleNotch size={16} className="animate-spin" />
                    ) : (
                        <Plus size={16} />
                    )}
                    Create Agent
                </Button>
            </div>
        </form>
    );
}

export function CreateAgentModal({
    open,
    initialTemplateKey,
    onClose,
}: {
    open: boolean;
    initialTemplateKey: string | null;
    onClose: () => void;
}) {
    if (!open) return null;
    return (
        <Modal onClose={onClose} maxWidth="max-w-2xl">
            <CreateAgentModalContent initialTemplateKey={initialTemplateKey} onClose={onClose} />
        </Modal>
    );
}
