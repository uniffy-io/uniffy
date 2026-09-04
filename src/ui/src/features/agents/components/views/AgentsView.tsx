import { useEffect, useMemo, useState } from "react";
import {
  ArrowCounterClockwise,
  ArrowLeft,
  Books,
  CircleNotch,
  Copy,
  Flask,
  Lightning,
  Plus,
  Robot,
  Trash,
  UsersThree,
  Wrench,
} from "@phosphor-icons/react";
import { useNavigate, useParams } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PaneBackLink, PaneHeader, PaneHeaderBar } from "@/components/ui/pane-header";
import { Tabs } from "@/components/ui/tabs";
import { AccessModeIcon, useAccessPolicyDialog, useMyContentRole } from "@/features/permissions";
import {
  BrowseBody,
  BrowseCard,
  BrowseEmpty,
  BrowseGrid,
  BrowseGroupLabel,
  BrowseHeader,
} from "@/features/agents/components/browse/BrowseSurface";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { roleCanEdit, roleCanManage } from "@/shared/utils/contentRoles";
import {
  selectAllAgents,
  selectAgentsLoading,
  selectDeletedAgents,
} from "@/features/agents/store/agentsSlice";
import { cloneAgent, deleteAgent, restoreAgent } from "@/features/agents/store/agentsThunks";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAgentsBuilderAccess } from "@/features/agents/hooks/useAgentsBuilderAccess";
import { fetchProviderKeys } from "@/features/agents/store/agentProvidersThunks";
import { OverviewTab } from "@/features/agents/components/views/AgentsView/OverviewTab";
import { InstructionsTab } from "@/features/agents/components/views/AgentsView/InstructionsTab";
import { CapabilitiesTab } from "@/features/agents/components/views/AgentsView/CapabilitiesTab";
import { MemoriesTab } from "@/features/agents/components/views/AgentsView/MemoriesTab";
import { AgentAvatar } from "@/features/agents/components/AgentAvatar";
import { AgentTestDrawer } from "@/features/agents/components/AgentTestDrawer";
import { ProviderLogo } from "@/features/agents/components/ProviderLogo";
import { selectProviderKeys } from "@/features/agents/store/agentProvidersSlice";

const headerButtonClass = cn(
  "group/btn relative flex items-center justify-center h-7 w-7 rounded-md",
  "border border-border-strong bg-transparent text-muted-foreground",
  "transition-all duration-300 ease-out",
  "hover:border-border-strong hover:bg-muted hover:text-primary",
);

const headerChipClass = cn(
  "group/btn flex items-center gap-1 h-7 px-1.5 rounded-md",
  "border border-border-strong bg-transparent text-xs text-muted-foreground",
  "transition-all duration-300 ease-out",
  "hover:border-border-strong hover:bg-muted hover:text-primary",
);

function AgentCard({
  agent,
  providerKeys,
  onOpen,
}: {
  agent: SerializedAgent;
  providerKeys: Record<string, { provider: string }>;
  onOpen: () => void;
}) {
  const provider = providerKeys[agent.primaryProviderKeyId]?.provider;
  const toolCount = agent.enabledTools.length;
  const skillCount = agent.enabledSkills.length;

  return (
    <BrowseCard
      onOpen={onOpen}
      dimmed={agent.isDeleted}
      testId={`agents-card-${agent.id}`}
      leading={
        <AgentAvatar
          avatarKey={agent.avatarKey}
          avatarEmoji={agent.avatarEmoji}
          agentName={agent.name}
          size="lg"
        />
      }
      title={agent.name}
      subtitle={agent.soulPrompt || "No instructions yet"}
      badges={
        <div className="flex shrink-0 items-center gap-1">
          {agent.isDefault && (
            <Badge variant="default" className="px-1.5 py-0 text-[10px]">
              default
            </Badge>
          )}
          {agent.isDeleted ? (
            <Trash size={13} className="text-muted-foreground" />
          ) : (
            <AccessModeIcon mode={agent.accessMode} size={13} className="text-muted-foreground" />
          )}
        </div>
      }
      chips={
        <>
          <Badge variant="secondary" className="gap-1 font-mono text-[10px] font-medium">
            <ProviderLogo provider={provider} size="sm" />
            {agent.primaryModel || "No model"}
          </Badge>
          {toolCount > 0 && (
            <Badge variant="secondary" className="gap-1 text-[10px] font-medium">
              <Wrench size={10} />
              {toolCount} tools
            </Badge>
          )}
          {skillCount > 0 && (
            <Badge variant="secondary" className="gap-1 text-[10px] font-medium">
              <Lightning size={10} />
              {skillCount} skills
            </Badge>
          )}
        </>
      }
    />
  );
}

function AgentsBrowse({
  agents,
  deletedAgents,
  providerKeys,
  onNewAgent,
  onOpen,
  onBrowseCatalog,
}: {
  agents: SerializedAgent[];
  deletedAgents: SerializedAgent[];
  providerKeys: Record<string, { provider: string }>;
  onNewAgent: () => void;
  onOpen: (agentId: string) => void;
  onBrowseCatalog: () => void;
}) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const match = (agent: SerializedAgent) => !query || agent.name.toLowerCase().includes(query);

  const live = agents.filter(match);
  const retired = deletedAgents.filter(match);
  const nothingAtAll = agents.length === 0 && deletedAgents.length === 0;

  return (
    <>
      <BrowseHeader
        icon={Robot}
        title="Agents"
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search agents..."
        testId="agents-browse-header"
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={onBrowseCatalog}
              data-testid="agents-browse-catalog-button"
            >
              <Books size={16} />
              Catalog
            </Button>
            <Button onClick={onNewAgent} data-testid="agents-new-agent-button">
              <Plus size={16} />
              New agent
            </Button>
          </div>
        }
      />
      <BrowseBody testId="agents-browse-body">
        {nothingAtAll ? (
          <BrowseEmpty
            icon={Robot}
            title="No agents yet"
            description="Start from a catalog template, or build one from scratch."
            testId="agents-browse-empty"
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button onClick={onBrowseCatalog}>
                  <Books size={16} />
                  Browse the catalog
                </Button>
                <Button
                  variant="ghost"
                  onClick={onNewAgent}
                  data-testid="agents-blank-agent-button"
                >
                  <Plus size={16} />
                  Blank agent
                </Button>
              </div>
            }
          />
        ) : live.length === 0 && retired.length === 0 ? (
          <BrowseEmpty
            icon={Robot}
            title="No match"
            description={`No agent matches "${search.trim()}".`}
          />
        ) : (
          <>
            {live.length > 0 && (
              <BrowseGrid>
                {live.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    providerKeys={providerKeys}
                    onOpen={() => onOpen(agent.id)}
                  />
                ))}
              </BrowseGrid>
            )}
            {retired.length > 0 && (
              <>
                <BrowseGroupLabel>Deleted</BrowseGroupLabel>
                <BrowseGrid>
                  {retired.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      providerKeys={providerKeys}
                      onOpen={() => onOpen(agent.id)}
                    />
                  ))}
                </BrowseGrid>
              </>
            )}
          </>
        )}
      </BrowseBody>
    </>
  );
}

export function AgentsView({ onNewAgent }: { onNewAgent: (templateKey?: string) => void }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { subId: agentId, panel } = useParams<{ subId?: string; panel?: string }>();
  const agentsMap = useAppSelector(selectAllAgents);
  const deletedAgentsMap = useAppSelector(selectDeletedAgents);
  const loading = useAppSelector(selectAgentsLoading);
  const providerKeys = useAppSelector(selectProviderKeys);
  const { isBuilder } = useAgentsBuilderAccess();

  useEffect(() => {
    dispatch(fetchProviderKeys());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const agents = useMemo(() => Object.values(agentsMap), [agentsMap]);
  const deletedAgents = useMemo(() => Object.values(deletedAgentsMap), [deletedAgentsMap]);

  // A retired agent is still reachable by URL from the deleted group, so the
  // detail page resolves against both sets and renders read-only for one.
  const selectedAgent = useMemo(
    () => (agentId ? (agentsMap[agentId] ?? deletedAgentsMap[agentId] ?? null) : null),
    [agentId, agentsMap, deletedAgentsMap],
  );
  const isRetired = selectedAgent?.isDeleted === true;

  const selectedAgentRole = useMyContentRole(
    ContentType.AGENT,
    agentId ?? "",
    selectedAgent?.userRole,
  );
  const canShareSelectedAgent = roleCanManage(selectedAgentRole);
  const { openFor: openAccessPolicyDialog } = useAccessPolicyDialog();

  const [testDrawerOpen, setTestDrawerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleCloneAgent = async () => {
    if (!agentId) return;
    const result = await dispatch(cloneAgent(agentId)).unwrap();
    navigate(`/agents/agents/${result.id}`);
  };

  const handleDeleteAgent = async () => {
    if (!agentId) return;
    setDeleting(true);
    try {
      await dispatch(deleteAgent(agentId)).unwrap();
      setDeleteOpen(false);
      navigate("/agents/agents");
    } finally {
      setDeleting(false);
    }
  };

  const handleRestoreAgent = async () => {
    if (!agentId) return;
    await dispatch(restoreAgent(agentId)).unwrap();
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
        <AgentsBrowse
          agents={agents}
          deletedAgents={deletedAgents}
          providerKeys={providerKeys}
          onNewAgent={() => onNewAgent()}
          onOpen={(id) => navigate(`/agents/agents/${id}/overview`)}
          onBrowseCatalog={() => navigate("/agents/catalog")}
        />
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
        <PaneHeader>
          <PaneHeaderBar
            eyebrow={
              <PaneBackLink
                onClick={() => navigate("/agents/agents")}
                data-testid="agents-detail-back"
              >
                <ArrowLeft size={14} />
                All agents
              </PaneBackLink>
            }
            icon={
              <AgentAvatar
                avatarKey={selectedAgent.avatarKey}
                avatarEmoji={selectedAgent.avatarEmoji}
                agentName={selectedAgent.name}
                size="lg"
              />
            }
            title={
              <>
                <span className="truncate" data-testid="agents-detail-name">
                  {selectedAgent.name}
                </span>
                <span
                  className={cn(headerChipClass, "font-mono text-xs shrink-0")}
                  data-testid="agents-detail-model-chip"
                >
                  <ProviderLogo
                    provider={providerKeys[selectedAgent.primaryProviderKeyId]?.provider}
                    size="sm"
                  />
                  {selectedAgent.primaryModel || "No model configured"}
                </span>
                {isRetired && (
                  <span
                    className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                    data-testid="agents-detail-deleted-badge"
                  >
                    Deleted
                  </span>
                )}
              </>
            }
          >
            <div className="flex items-center gap-1.5 shrink-0">
              {isRetired ? (
                isBuilder && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRestoreAgent}
                    data-testid="agents-restore-button"
                  >
                    <ArrowCounterClockwise size={14} />
                    Restore
                  </Button>
                )
              ) : (
                <>
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
                  {isBuilder && (
                    <button
                      type="button"
                      className={headerButtonClass}
                      onClick={() => setDeleteOpen(true)}
                      title="Delete agent"
                      data-testid="agents-delete-button"
                    >
                      <Trash size={16} />
                    </button>
                  )}
                  {canShareSelectedAgent && (
                    <button
                      type="button"
                      className={headerButtonClass}
                      onClick={() =>
                        openAccessPolicyDialog(
                          ContentType.AGENT,
                          selectedAgent.id,
                          selectedAgent.name,
                        )
                      }
                      title="Share"
                      data-testid="agents-share-button"
                    >
                      <UsersThree size={16} />
                    </button>
                  )}
                </>
              )}
            </div>
          </PaneHeaderBar>
        </PaneHeader>

        {isRetired && (
          <div
            className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground"
            data-testid="agents-detail-deleted-notice"
          >
            <Trash size={14} />
            <span>
              This agent is deleted. It cannot answer in chat and its automations are paused. Past
              conversations keep its name and replies.
            </span>
          </div>
        )}

        <div className="px-4 border-b border-border">
          <Tabs items={tabItems} />
        </div>

        <div
          className={cn(
            "flex-1 p-6",
            activePanel === "instructions" ? "overflow-hidden" : "overflow-y-auto",
          )}
        >
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

      <ConfirmDialog
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDeleteAgent}
        title={`Delete ${selectedAgent.name}?`}
        confirmLabel="Delete agent"
        loading={deleting}
        message={
          <div className="space-y-2">
            <p>It stops answering everywhere and its automations are paused.</p>
            <p>
              Existing chats stay readable and its past replies keep this name and avatar. The chats
              become read-only.
            </p>
            <p>You can restore it later from the Deleted group.</p>
          </div>
        }
      />
    </div>
  );
}
