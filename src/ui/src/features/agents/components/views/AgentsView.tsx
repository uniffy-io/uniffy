import { useEffect, useMemo, useState, useCallback } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
    ArrowClockwise,
    Copy,
    File,
    Wrench,
    Lightning,
    Plugs,
    ClockCounterClockwise,
    CircleNotch,
    Plus,
    Scroll,
    LockSimple,
    UsersThree,
    Buildings,
    CaretDown,
    CaretRight,
} from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { loadPanelLayout, savePanelLayout } from "@/shared/utils/panelStorage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ShareButton, useMyPermission } from "@/features/sharing";
import { ContentType, VisibilityScope } from "@uniffy/proto/common/v1/common_pb";
import {
    selectSelectedAgentId,
    selectAgentsPanel,
    setAgentsPanel,
} from "@/features/agents/store/agentsUiSlice";
import type { AgentsPanel } from "@/features/agents/store/agentsUiSlice";
import { selectAllAgents, selectAgentsLoading } from "@/features/agents/store/agentsSlice";
import { fetchAgents, createAgent, cloneAgent, updateAgent } from "@/features/agents/store/agentsThunks";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";
import { fetchProviderKeys } from "@/features/agents/store/agentProvidersThunks";
import { OverviewTab } from "@/features/agents/components/views/AgentsView/OverviewTab";
import { ToolsTab } from "@/features/agents/components/views/AgentsView/ToolsTab";
import { InstructionsTab } from "@/features/agents/components/views/AgentsView/InstructionsTab";
import { SkillsTab } from "@/features/agents/components/views/AgentsView/SkillsTab";
import { AgentAvatar } from "@/features/agents/components/AgentAvatar";
import { AutomationsView } from "@/features/agents/components/views/AutomationsView";
import { MemoriesTab } from "@/features/agents/components/views/AgentsView/MemoriesTab";

const PANEL_TABS: { key: AgentsPanel; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "instructions", label: "Instructions" },
    { key: "tools", label: "Tools" },
    { key: "skills", label: "Skills" },
    { key: "memories", label: "Memories" },
    { key: "files", label: "Files" },
    { key: "integrations", label: "Integrations" },
    { key: "automations", label: "Automations" },
];

const PANEL_ICONS: Record<string, React.ElementType> = {
    instructions: Scroll,
    files: File,
    tools: Wrench,
    skills: Lightning,
    integrations: Plugs,
    automations: ClockCounterClockwise,
};

interface AgentSectionConfig {
    id: "personal" | "shared" | "organization";
    name: string;
    icon: React.ElementType;
}

const SIDEBAR_SECTIONS: AgentSectionConfig[] = [
    { id: "personal", name: "My Agents", icon: LockSimple },
    { id: "shared", name: "Shared With Me", icon: UsersThree },
    { id: "organization", name: "Organization", icon: Buildings },
];

const VISIBILITY_ICON: Record<number, React.ElementType> = {
    [VisibilityScope.PRIVATE]: LockSimple,
    [VisibilityScope.GROUP]: UsersThree,
    [VisibilityScope.ORGANIZATION]: Buildings,
};

function PlaceholderPanel({ panelKey }: { panelKey: string }) {
    const Icon = PANEL_ICONS[panelKey];

    return (
        <div className="bg-muted/30 border border-dashed border-border rounded-lg p-8 text-center">
            {Icon && (
                <Icon
                    size={32}
                    className="text-muted-foreground mx-auto mb-2"
                />
            )}
            <p className="font-medium text-foreground capitalize">{panelKey}</p>
            <p className="text-sm text-muted-foreground mt-1">
                Coming soon - agent {panelKey} configuration
            </p>
        </div>
    );
}

export function AgentsView() {
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const selectedAgentId = useAppSelector(selectSelectedAgentId);
    const agentsPanel = useAppSelector(selectAgentsPanel);
    const agentsMap = useAppSelector(selectAllAgents);
    const loading = useAppSelector(selectAgentsLoading);
    const currentUserId = useAppSelector((state) => state.auth.user?.id);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [newAgentName, setNewAgentName] = useState("");
    const [newAgentVisibility, setNewAgentVisibility] = useState<number>(VisibilityScope.PRIVATE);
    const [creating, setCreating] = useState(false);
    const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

    const agents = useMemo(() => Object.values(agentsMap), [agentsMap]);

    const agentsBySection = useMemo(() => {
        const result: Record<string, SerializedAgent[]> = {
            personal: [],
            shared: [],
            organization: [],
        };
        for (const agent of agents) {
            if (agent.visibility === VisibilityScope.ORGANIZATION) {
                result.organization.push(agent);
            } else if (agent.ownerId === currentUserId) {
                result.personal.push(agent);
            } else {
                result.shared.push(agent);
            }
        }
        return result;
    }, [agents, currentUserId]);

    useEffect(() => {
        dispatch(fetchAgents());
        dispatch(fetchProviderKeys());
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const selectedAgent = useMemo(
        () => (selectedAgentId ? agentsMap[selectedAgentId] ?? null : null),
        [selectedAgentId, agentsMap]
    );

    const { permission: selectedAgentPermission } = useMyPermission(
        ContentType.AGENT,
        selectedAgentId ?? null,
    );
    const canShareSelectedAgent = selectedAgentPermission?.canShare ?? selectedAgentPermission?.isOwner ?? false;

    // No auto-select - URL drives selection. If no agent in URL, show empty state.

    const handleCreateAgent = async () => {
        const name = newAgentName.trim();
        if (!name || creating) return;
        setCreating(true);
        try {
            const result = await dispatch(
                createAgent({
                    name,
                    visibility: newAgentVisibility,
                })
            ).unwrap();
            navigate(`/agents/agents/${result.id}`);
            setNewAgentName("");
            setNewAgentVisibility(VisibilityScope.PRIVATE);
            setShowCreateForm(false);
        } finally {
            setCreating(false);
        }
    };

    const handleCloneAgent = async () => {
        if (!selectedAgentId) return;
        const result = await dispatch(cloneAgent(selectedAgentId)).unwrap();
        navigate(`/agents/agents/${result.id}`);
    };

    const isPersonalAgent = selectedAgent?.ownerId === currentUserId
        && selectedAgent?.visibility !== VisibilityScope.ORGANIZATION;
    const canMoveToOrg = isPersonalAgent && (
        selectedAgentPermission?.isOwner ?? false
    );

    const [showMoveToOrgConfirm, setShowMoveToOrgConfirm] = useState(false);
    const [movingToOrg, setMovingToOrg] = useState(false);

    const handleMoveToOrgConfirm = async () => {
        if (!selectedAgentId || movingToOrg) return;
        setMovingToOrg(true);
        try {
            await dispatch(updateAgent({
                agentId: selectedAgentId,
                visibility: VisibilityScope.ORGANIZATION,
            })).unwrap();
            setShowMoveToOrgConfirm(false);
        } finally {
            setMovingToOrg(false);
        }
    };

    const toggleSection = (sectionId: string) => {
        setCollapsedSections((prev) => ({
            ...prev,
            [sectionId]: !prev[sectionId],
        }));
    };

    const [defaultAgentsLayout] = useState(() => loadPanelLayout("agents-list"));

    const handleAgentsLayoutChange = useCallback(
        (layout: Record<string, number>) => {
            savePanelLayout("agents-list", layout);
        },
        [],
    );

    if (loading && agents.length === 0) {
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
                defaultLayout={defaultAgentsLayout}
                onLayoutChange={handleAgentsLayoutChange}
            >
            <Panel
                id="agents-list"
                defaultSize={260}
                minSize={200}
                maxSize={400}
                className="border-r border-border bg-card overflow-hidden"
            >
            <div className="h-full flex flex-col">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <span className="font-semibold text-foreground">Agents</span>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => dispatch(fetchAgents())}
                        >
                            <ArrowClockwise size={16} />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={showCreateForm ? "text-primary bg-primary/10" : ""}
                            onClick={() => setShowCreateForm(!showCreateForm)}
                        >
                            <Plus size={16} />
                        </Button>
                    </div>
                </div>

                {showCreateForm && (
                    <div className="px-3 py-3 border-b border-border space-y-2 bg-muted/30">
                        <Input
                            value={newAgentName}
                            onChange={(e) => setNewAgentName(e.target.value)}
                            placeholder="Agent name"
                            className="h-8"
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleCreateAgent();
                                if (e.key === "Escape") setShowCreateForm(false);
                            }}
                            autoFocus
                        />
                        <div className="space-y-1">
                            {([
                                { value: VisibilityScope.PRIVATE, label: "Private", desc: "Only you can use this agent" },
                                { value: VisibilityScope.ORGANIZATION, label: "Organization", desc: "All members can use this agent" },
                            ] as const).map((opt) => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setNewAgentVisibility(opt.value)}
                                    className={cn(
                                        "w-full px-2.5 py-1.5 rounded-lg border text-left text-xs transition-colors",
                                        newAgentVisibility === opt.value
                                            ? "bg-primary/10 border-primary text-foreground"
                                            : "bg-muted border-border text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    <span className="font-medium">{opt.label}</span>
                                    <span className="block text-[10px] text-muted-foreground">{opt.desc}</span>
                                </button>
                            ))}
                        </div>
                        <Button
                            onClick={handleCreateAgent}
                            disabled={!newAgentName.trim() || creating}
                            className="w-full"
                            size="sm"
                        >
                            {creating ? "Creating..." : "Create Agent"}
                        </Button>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto">
                    {SIDEBAR_SECTIONS.map((section) => {
                        const sectionAgents = agentsBySection[section.id] || [];
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
                                    <span className="text-muted-foreground">{sectionAgents.length}</span>
                                </button>
                                {!isCollapsed && sectionAgents.map((agent) => {
                                    const isSelected = agent.id === selectedAgentId;
                                    const VisIcon = VISIBILITY_ICON[agent.visibility] || LockSimple;
                                    return (
                                        <button
                                            key={agent.id}
                                            type="button"
                                            onClick={() => navigate(`/agents/agents/${agent.id}`)}
                                            className={cn(
                                                "w-full px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors text-left",
                                                isSelected
                                                    ? "bg-primary/10 border-l-2 border-primary"
                                                    : "hover:bg-muted border-l-2 border-transparent"
                                            )}
                                        >
                                            <AgentAvatar
                                                avatarKey={agent.avatarKey}
                                                avatarEmoji={agent.avatarEmoji}
                                                agentName={agent.name}
                                                size="md"
                                            />
                                            <div className="flex flex-col flex-1 min-w-0">
                                                <span className="text-sm font-medium truncate text-foreground">
                                                    {agent.name}
                                                </span>
                                                <span className="text-xs text-muted-foreground font-mono truncate">
                                                    {agent.primaryModel || "No model"}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                {agent.isDefault && (
                                                    <Badge variant="default" className="shrink-0">default</Badge>
                                                )}
                                                <VisIcon size={14} className="text-muted-foreground" />
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            </div>
            </Panel>

            <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />

            <Panel id="agents-detail" minSize={400}>
            <div className="h-full flex flex-col overflow-hidden">
                {selectedAgent ? (
                    <>
                        <div className="px-6 py-4 border-b border-border">
                            <div className="flex items-center gap-4">
                                <AgentAvatar
                                    avatarKey={selectedAgent.avatarKey}
                                    avatarEmoji={selectedAgent.avatarEmoji}
                                    agentName={selectedAgent.name}
                                    size="xl"
                                />
                                <div className="flex-1 min-w-0">
                                    <h2 className="text-xl font-semibold text-foreground">
                                        {selectedAgent.name}
                                    </h2>
                                    <p className="text-sm text-muted-foreground font-mono truncate">
                                        {selectedAgent.primaryModel || "No model configured"}
                                    </p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={handleCloneAgent}
                                    title="Clone agent"
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
                                {canShareSelectedAgent && (
                                    <ShareButton
                                        contentType={ContentType.AGENT}
                                        contentId={selectedAgent.id}
                                        contentTitle={selectedAgent.name}
                                        iconOnly
                                    />
                                )}
                            </div>
                        </div>

                        <div className="px-6 border-b border-border flex gap-0">
                            {PANEL_TABS.map((tab) => (
                                <button
                                    key={tab.key}
                                    type="button"
                                    onClick={() => dispatch(setAgentsPanel(tab.key))}
                                    className={cn(
                                        "px-4 py-2 text-sm cursor-pointer transition-colors",
                                        agentsPanel === tab.key
                                            ? "text-primary border-b-2 border-primary font-medium"
                                            : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        <div className={cn(
                            "flex-1 p-6",
                            agentsPanel === "instructions"
                                ? "overflow-hidden"
                                : "overflow-y-auto",
                        )}>
                            {agentsPanel === "overview" ? (
                                <OverviewTab agent={selectedAgent} />
                            ) : agentsPanel === "instructions" ? (
                                <InstructionsTab agent={selectedAgent} />
                            ) : agentsPanel === "tools" ? (
                                <ToolsTab agent={selectedAgent} />
                            ) : agentsPanel === "skills" ? (
                                <SkillsTab agent={selectedAgent} />
                            ) : agentsPanel === "memories" ? (
                                <MemoriesTab agent={selectedAgent} />
                            ) : agentsPanel === "automations" ? (
                                <AutomationsView agentId={selectedAgent.id} />
                            ) : (
                                <PlaceholderPanel panelKey={agentsPanel} />
                            )}
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center">
                        <p className="text-muted-foreground">
                            Select an agent from the sidebar
                        </p>
                    </div>
                )}
            </div>
            </Panel>
            </Group>

            <ConfirmDialog
                isOpen={showMoveToOrgConfirm}
                onClose={() => setShowMoveToOrgConfirm(false)}
                onConfirm={handleMoveToOrgConfirm}
                title="Move to Organization"
                message="Moving this agent to Organization will make it visible to all organization members. This action cannot be undone."
                confirmLabel="Move to Organization"
                cancelLabel="Cancel"
                variant="warning"
                loading={movingToOrg}
            />
        </div>
    );
}
