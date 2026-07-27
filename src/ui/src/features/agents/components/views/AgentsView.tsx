import { useEffect, useMemo, useState } from "react";
import {
    CircleNotch,
    Copy,
    Flask,
    Plus,
    Robot,
    UsersThree,
} from "@phosphor-icons/react";
import { useNavigate, useParams } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { useAccessPolicyDialog, useMyContentRole } from "@/features/permissions";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { roleCanEdit, roleCanManage } from "@/shared/utils/contentRoles";
import { selectAllAgents, selectAgentsLoading } from "@/features/agents/store/agentsSlice";
import { cloneAgent } from "@/features/agents/store/agentsThunks";
import { fetchProviderKeys } from "@/features/agents/store/agentProvidersThunks";
import { selectAllSkills } from "@/features/agents/store/agentSkillsSlice";
import { fetchSkills } from "@/features/agents/store/agentSkillsThunks";
import { selectAgentTemplates } from "@/features/agents/store/agentTemplatesSlice";
import { fetchAgentTemplates } from "@/features/agents/store/agentTemplatesThunks";
import { OverviewTab } from "@/features/agents/components/views/AgentsView/OverviewTab";
import { InstructionsTab } from "@/features/agents/components/views/AgentsView/InstructionsTab";
import { CapabilitiesTab } from "@/features/agents/components/views/AgentsView/CapabilitiesTab";
import { MemoriesTab } from "@/features/agents/components/views/AgentsView/MemoriesTab";
import { AgentAvatar } from "@/features/agents/components/AgentAvatar";
import { AgentTestDrawer } from "@/features/agents/components/AgentTestDrawer";

const headerButtonClass = cn(
    "group/btn relative flex items-center justify-center h-7 w-7 rounded-md",
    "border border-foreground/15 bg-transparent text-muted-foreground",
    "transition-all duration-300 ease-out",
    "hover:border-foreground/30 hover:bg-muted hover:text-primary",
);

const headerChipClass = cn(
    "group/btn flex items-center gap-1 h-7 px-1.5 rounded-md",
    "border border-foreground/15 bg-transparent text-xs text-muted-foreground",
    "transition-all duration-300 ease-out",
    "hover:border-foreground/30 hover:bg-muted hover:text-primary",
);

function TemplateGallery({ onNewAgent }: { onNewAgent: (templateKey?: string) => void }) {
    const dispatch = useAppDispatch();
    const skillsMap = useAppSelector(selectAllSkills);
    const templates = useAppSelector(selectAgentTemplates);

    useEffect(() => {
        dispatch(fetchAgentTemplates());
        if (Object.keys(skillsMap).length === 0) {
            dispatch(fetchSkills());
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const cardClass = cn(
        "flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-4",
        "text-left transition-colors hover:border-primary/50 cursor-pointer",
    );

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-6">
                <div className="w-full max-w-3xl">
                    <div className="text-center mb-6">
                        <h2 className="text-lg font-semibold text-foreground">
                            Create your first agent
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">
                            Start from a template or build one from scratch.
                        </p>
                    </div>
                    <div
                        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                        data-testid="agents-template-gallery"
                    >
                        <button
                            type="button"
                            onClick={() => onNewAgent()}
                            className={cardClass}
                            data-testid="agents-template-card-blank"
                        >
                            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <Plus size={18} weight="bold" />
                            </span>
                            <span className="text-sm font-medium text-foreground">Blank</span>
                            <span className="text-xs text-muted-foreground">
                                Start from scratch with an empty agent
                            </span>
                        </button>
                        {templates.map((template) => (
                            <button
                                key={template.key}
                                type="button"
                                onClick={() => onNewAgent(template.key)}
                                className={cardClass}
                                data-testid={`agents-template-card-${template.key}`}
                            >
                                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
                                    {template.emoji}
                                </span>
                                <span className="text-sm font-medium text-foreground">
                                    {template.name}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    {template.description}
                                </span>
                                {template.enabledSkillIds.length > 0 && (
                                    <span className="flex flex-wrap items-center gap-1">
                                        {template.enabledSkillIds.map((skillId) => (
                                            <Badge
                                                key={skillId}
                                                variant="secondary"
                                                className="text-[10px] font-medium"
                                            >
                                                {skillsMap[skillId]?.displayName ?? "Skill"}
                                            </Badge>
                                        ))}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

export function AgentsView({ onNewAgent }: { onNewAgent: (templateKey?: string) => void }) {
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const { subId: agentId, panel } = useParams<{ subId?: string; panel?: string }>();
    const agentsMap = useAppSelector(selectAllAgents);
    const loading = useAppSelector(selectAgentsLoading);

    useEffect(() => {
        dispatch(fetchProviderKeys());
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const agents = useMemo(() => Object.values(agentsMap), [agentsMap]);

    const selectedAgent = useMemo(
        () => (agentId ? agentsMap[agentId] ?? null : null),
        [agentId, agentsMap],
    );

    const selectedAgentRole = useMyContentRole(
        ContentType.AGENT,
        agentId ?? "",
        selectedAgent?.userRole,
    );
    const canShareSelectedAgent = roleCanManage(selectedAgentRole);
    const { openFor: openAccessPolicyDialog } = useAccessPolicyDialog();

    const [testDrawerOpen, setTestDrawerOpen] = useState(false);

    const handleCloneAgent = async () => {
        if (!agentId) return;
        const result = await dispatch(cloneAgent(agentId)).unwrap();
        navigate(`/agents/agents/${result.id}`);
    };

    if (loading && agents.length === 0) {
        return (
            <div className="flex h-full items-center justify-center" data-testid="agents-view">
                <CircleNotch size={32} className="animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!selectedAgent) {
        return (
            <div className="flex h-full flex-col overflow-hidden" data-testid="agents-view">
                {agents.length === 0 ? (
                    <TemplateGallery onNewAgent={onNewAgent} />
                ) : (
                    <div className="flex flex-1 items-center justify-center px-4">
                        <div className="flex flex-col items-center text-center max-w-md">
                            <Robot size={48} weight="light" className="text-muted-foreground/30 mb-4" />
                            <h2 className="text-lg font-semibold text-foreground">
                                No agent selected
                            </h2>
                            <p className="text-sm text-muted-foreground mt-1">
                                Select an agent from the sidebar
                            </p>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    const activePanel = panel ?? "overview";
    const tabItems = [
        {
            to: `/agents/agents/${selectedAgent.id}/overview`,
            label: "Overview",
            end: true,
            testId: "agents-detail-tab-overview",
        },
        {
            to: `/agents/agents/${selectedAgent.id}/instructions`,
            label: "Instructions",
            testId: "agents-detail-tab-instructions",
        },
        {
            to: `/agents/agents/${selectedAgent.id}/capabilities`,
            label: "Capabilities",
            testId: "agents-detail-tab-capabilities",
        },
        {
            to: `/agents/agents/${selectedAgent.id}/memory`,
            label: "Memory",
            testId: "agents-detail-tab-memory",
        },
    ];

    return (
        <div className="flex h-full flex-col overflow-hidden" data-testid="agents-view">
            <div
                className="flex flex-1 min-h-0 flex-col overflow-hidden"
                data-testid="agents-detail-panel"
                data-agent-id={selectedAgent.id}
                data-panel={activePanel}
            >
            <div className="border-b border-border/60 bg-card">
                <div className="flex items-center gap-3 px-4 py-2">
                    <AgentAvatar
                        avatarKey={selectedAgent.avatarKey}
                        avatarEmoji={selectedAgent.avatarEmoji}
                        agentName={selectedAgent.name}
                        size="lg"
                    />
                    <h2
                        className="text-xl font-semibold text-foreground truncate"
                        data-testid="agents-detail-name"
                    >
                        {selectedAgent.name}
                    </h2>
                    <span className={cn(headerChipClass, "font-mono text-xs shrink-0")}>
                        {selectedAgent.primaryModel || "No model configured"}
                    </span>
                    <div className="ml-auto flex items-center gap-1.5 shrink-0">
                        <button
                            type="button"
                            className={headerButtonClass}
                            onClick={() => setTestDrawerOpen(true)}
                            title="Test agent"
                            data-testid="agents-test-button"
                        >
                            <Flask size={16} />
                        </button>
                        <button
                            type="button"
                            className={headerButtonClass}
                            onClick={handleCloneAgent}
                            title="Clone agent"
                            data-testid="agents-clone-button"
                        >
                            <Copy size={16} />
                        </button>
                        {canShareSelectedAgent && (
                            <button
                                type="button"
                                className={headerButtonClass}
                                onClick={() => openAccessPolicyDialog(
                                    ContentType.AGENT,
                                    selectedAgent.id,
                                    selectedAgent.name,
                                )}
                                title="Share"
                                data-testid="agents-share-button"
                            >
                                <UsersThree size={16} />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="px-4 border-b border-border">
                <Tabs items={tabItems} />
            </div>

            <div className={cn(
                "flex-1 p-6",
                activePanel === "instructions" ? "overflow-hidden" : "overflow-y-auto",
            )}>
                {activePanel === "overview" ? (
                    <OverviewTab agent={selectedAgent} />
                ) : activePanel === "instructions" ? (
                    <InstructionsTab agent={selectedAgent} />
                ) : activePanel === "capabilities" ? (
                    <CapabilitiesTab agent={selectedAgent} />
                ) : (
                    <MemoriesTab agent={selectedAgent} />
                )}
            </div>
            </div>

            <AgentTestDrawer
                agent={selectedAgent}
                mode="test"
                canEdit={roleCanEdit(selectedAgentRole)}
                open={testDrawerOpen}
                onClose={() => setTestDrawerOpen(false)}
            />
        </div>
    );
}
