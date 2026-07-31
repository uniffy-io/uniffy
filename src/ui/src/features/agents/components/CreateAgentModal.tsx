import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    Books,
    CircleNotch,
    Cpu,
    Image,
    Lightning,
    Plus,
    Robot,
    Wrench,
    X,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { AccessMode } from "@uniffy/proto/common/v1/common_pb";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AgentAvatar } from "@/features/agents/components/AgentAvatar";
import { createAgent, updateAgent } from "@/features/agents/store/agentsThunks";
import { selectAllSkills } from "@/features/agents/store/agentSkillsSlice";
import { selectAgentTemplates } from "@/features/agents/store/agentTemplatesSlice";
import { selectAvailableModels } from "@/features/agents/store/agentProvidersSlice";

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

    const selectedTemplate = templates.find((t) => t.key === selectedTemplateKey) ?? null;
    const name = nameOverride ?? selectedTemplate?.name ?? "";

    // A template's recommended models apply only when an enabled org key
    // actually serves them; otherwise creation falls back to the org default.
    const availableModels = useAppSelector(selectAvailableModels);
    const recommendedModel = selectedTemplate?.recommendedModel
        ? (availableModels.find((m) => m.id === selectedTemplate.recommendedModel) ?? null)
        : null;
    const recommendedImageModel = selectedTemplate?.recommendedImageModel
        ? (availableModels.find(
              (m) =>
                  m.id === selectedTemplate.recommendedImageModel &&
                  m.supportsImageGeneration,
          ) ?? null)
        : null;

    const clearTemplate = () => {
        setNameOverride(name);
        setSelectedTemplateKey(null);
    };

    const browseCatalog = () => {
        navigate("/agents/catalog");
        onClose();
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
                              ...(recommendedModel
                                  ? { primaryModel: recommendedModel.id }
                                  : {}),
                              ...(recommendedImageModel
                                  ? { imageModel: recommendedImageModel.id }
                                  : {}),
                          }
                        : {}),
                }),
            ).unwrap();
            if (template && template.enabledTools.length > 0) {
                // CreateAgentRequest carries no tools field; enable them right after creation, clone-style, without blocking navigation.
                dispatch(updateAgent({ agentId: result.id, enabledTools: template.enabledTools }));
            }
            // Overview reads this once to walk the user through picking a model;
            // it clears the history entry so a reload does not re-trigger. The
            // walkthrough is skipped when the template's recommended model was
            // already applied.
            navigate(`/agents/agents/${result.id}/overview`, {
                state: { needsModelSetup: !recommendedModel },
            });
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
                    Name it and pick who can use it. Everything else is editable after.
                </p>
            </div>

            <div className="max-h-[65dvh] overflow-y-auto px-6 py-5 space-y-5">
                <div>
                    <label className="block text-sm text-muted-foreground mb-1">Starting from</label>
                    {selectedTemplate ? (
                        <div
                            className="flex items-start gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3"
                            data-testid="agents-create-template-summary"
                            data-template-key={selectedTemplate.key}
                        >
                            <AgentAvatar
                                avatarEmoji={selectedTemplate.emoji}
                                agentName={selectedTemplate.name}
                                size="md"
                            />
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-foreground">
                                    {selectedTemplate.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {selectedTemplate.description}
                                </p>
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                    <Badge variant="secondary" className="gap-1 text-[10px]">
                                        <Wrench size={10} />
                                        {selectedTemplate.enabledTools.length} tools
                                    </Badge>
                                    {recommendedModel && (
                                        <Badge
                                            variant="secondary"
                                            className="gap-1 text-[10px]"
                                            data-testid="agents-create-recommended-model"
                                        >
                                            <Cpu size={10} />
                                            {recommendedModel.displayName || recommendedModel.id}
                                        </Badge>
                                    )}
                                    {recommendedImageModel && (
                                        <Badge
                                            variant="secondary"
                                            className="gap-1 text-[10px]"
                                            data-testid="agents-create-recommended-image-model"
                                        >
                                            <Image size={10} />
                                            {recommendedImageModel.displayName ||
                                                recommendedImageModel.id}
                                        </Badge>
                                    )}
                                    {selectedTemplate.enabledSkillIds.map((skillId) => (
                                        <Badge
                                            key={skillId}
                                            variant="secondary"
                                            className="gap-1 text-[10px]"
                                        >
                                            <Lightning size={10} />
                                            {skillsMap[skillId]?.displayName ?? "Skill"}
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={clearTemplate}
                                title="Start blank instead"
                                aria-label="Start blank instead"
                                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                                data-testid="agents-create-clear-template"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    ) : (
                        <div
                            className="flex items-center gap-3 rounded-lg border border-border p-3"
                            data-testid="agents-create-template-blank"
                        >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                <Robot size={16} />
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-foreground">Blank agent</p>
                                <p className="text-xs text-muted-foreground">
                                    No instructions, no tools.
                                </p>
                            </div>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={browseCatalog}
                                data-testid="agents-create-browse-catalog"
                            >
                                <Books size={14} />
                                Browse catalog
                            </Button>
                        </div>
                    )}
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
        <Modal onClose={onClose} maxWidth="max-w-lg">
            <CreateAgentModalContent initialTemplateKey={initialTemplateKey} onClose={onClose} />
        </Modal>
    );
}
