import { useCallback, useEffect, useState } from "react";
import { Group, Panel } from "react-resizable-panels";
import { PaneSeparator } from "@/components/ui/pane-separator";
import { useNavigate, useParams } from "react-router-dom";
import { Books, ClockCounterClockwise, Robot, Lightning } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { clearPanelLayout, loadPanelLayout, savePanelLayout } from "@/shared/utils/panelStorage";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { Drawer } from "@/components/ui/drawer";
import {
  CollapsibleSidebarRail,
  type SidebarSection,
} from "@/components/layout/CollapsibleSidebarRail";
import { useShortcutHandler } from "@/features/settings";
import {
  selectSidebarCollapsed,
  setSidebarCollapsed,
  toggleSidebar,
  type AgentsSection,
} from "@/features/agents/store/agentsUiSlice";
import { fetchAgents, fetchDeletedAgents } from "@/features/agents/store/agentsThunks";
import { fetchSkills } from "@/features/agents/store/agentSkillsThunks";
import { createSkillDraft, fetchSkillDrafts } from "@/features/agents/store/agentSkillDraftsThunks";
import { fetchCronTasks } from "@/features/agents/store/agentCronThunks";
import {
  fetchAvailableModels,
  fetchProviderKeys,
} from "@/features/agents/store/agentProvidersThunks";
import {
  fetchConnections,
  fetchIntegrationProviders,
} from "@/features/integrations/store/integrationsThunks";
import { fetchAgentTemplates } from "@/features/agents/store/agentTemplatesThunks";
import { fetchAgentTools } from "@/features/agents/store/agentToolsThunks";
import { AgentsModuleSidebar } from "@/features/agents/components/layout/AgentsModuleSidebar";
import { AgentsView } from "@/features/agents/components/views/AgentsView";
import { CatalogView } from "@/features/agents/components/views/CatalogView";
import { SkillsView } from "@/features/agents/components/views/SkillsView";
import { AutomationsView } from "@/features/agents/components/views/AutomationsView";
import { CreateAgentModal } from "@/features/agents/components/CreateAgentModal";
import { CreateTaskModal } from "@/features/agents/components/CreateTaskModal";
import { ProviderKeyNotice } from "@/features/agents/components/ProviderKeyNotice";

export function AgentsLayout() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  const section = (tab ?? "agents") as AgentsSection;
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const sidebarCollapsed = useAppSelector(selectSidebarCollapsed);
  const { isMobile } = useBreakpoint();

  const [defaultLayout] = useState(() => {
    for (const staleKey of ["agents-nav", "agents-list", "agents-automations"]) {
      clearPanelLayout(staleKey);
    }
    return loadPanelLayout("agents-sidebar");
  });
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [createAgentTemplateKey, setCreateAgentTemplateKey] = useState<string | null>(null);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [creatingSkill, setCreatingSkill] = useState(false);

  // Fetched here, not in the sidebar: Zen mode and the mobile drawer unmount
  // the sidebar, and the content views still need this data. Keys and models
  // load up front so every model dropdown in the builder opens populated.
  useEffect(() => {
    dispatch(fetchAgents());
    dispatch(fetchDeletedAgents());
    dispatch(fetchSkills());
    dispatch(fetchSkillDrafts({ status: "pending" }));
    dispatch(fetchCronTasks());
    dispatch(fetchProviderKeys());
    dispatch(fetchAvailableModels());
    dispatch(fetchAgentTemplates());
    dispatch(fetchAgentTools());
    dispatch(fetchIntegrationProviders());
    dispatch(fetchConnections());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLayoutChange = useCallback((layout: Record<string, number>) => {
    savePanelLayout("agents-sidebar", layout);
  }, []);

  const handleToggleSidebar = useCallback(() => {
    dispatch(toggleSidebar());
  }, [dispatch]);

  useShortcutHandler("app.toggleSidebar", handleToggleSidebar);

  const handleNewAgent = useCallback((templateKey?: string) => {
    setCreateAgentTemplateKey(templateKey ?? null);
    setCreateAgentOpen(true);
  }, []);

  const handleNewSkill = useCallback(async () => {
    if (creatingSkill) return;
    setCreatingSkill(true);
    try {
      const draft = await dispatch(
        createSkillDraft({ kind: "create", name: "", displayName: "", content: "" }),
      ).unwrap();
      navigate(`/agents/skills/drafts/${draft.id}`);
    } finally {
      setCreatingSkill(false);
    }
    // The deps below ARE read in the body; oxlint's memo analysis misses reads
    // inside try/finally blocks and object-literal call arguments.
    // eslint-disable-next-line react/react-compiler
  }, [creatingSkill, dispatch, navigate]);

  const handleNewAutomation = useCallback(() => {
    setCreateTaskOpen(true);
  }, []);

  const railSections: SidebarSection[] = [
    {
      id: "agents",
      icon: Robot,
      label: "Agents",
      isActive: section === "agents",
      onClick: () => navigate("/agents/agents"),
    },
    {
      id: "catalog",
      icon: Books,
      label: "Catalog",
      isActive: section === "catalog",
      onClick: () => navigate("/agents/catalog"),
    },
    {
      id: "skills",
      icon: Lightning,
      label: "Skills",
      isActive: section === "skills",
      onClick: () => navigate("/agents/skills"),
    },
    {
      id: "automations",
      icon: ClockCounterClockwise,
      label: "Automations",
      isActive: section === "automations",
      onClick: () => navigate("/agents/automations"),
    },
  ];

  const sidebar = <AgentsModuleSidebar />;

  const sidebarAsDrawer = isMobile;
  const showSidebar = !isZenMode && !sidebarCollapsed;
  const showCollapsedRail = !isZenMode && sidebarCollapsed && !sidebarAsDrawer;

  return (
    <div
      className={cn(
        "relative bg-background text-foreground overflow-hidden",
        "transition-[height] duration-300 ease-in-out",
        isZenMode ? "h-dvh delay-150" : "h-[calc(100dvh-3rem)] delay-0",
      )}
    >
      {showCollapsedRail && (
        <div className="absolute inset-y-0 left-0 z-30 w-12">
          <CollapsibleSidebarRail onExpand={handleToggleSidebar} sections={railSections}>
            {sidebar}
          </CollapsibleSidebarRail>
        </div>
      )}

      <Group
        orientation="horizontal"
        className="h-full w-full flex"
        defaultLayout={defaultLayout}
        onLayoutChange={handleLayoutChange}
      >
        {showSidebar && !sidebarAsDrawer && (
          <>
            <Panel
              id="agents-sidebar"
              defaultSize={280}
              minSize={180}
              maxSize={400}
              className="bg-nav overflow-hidden"
            >
              {sidebar}
            </Panel>

            <PaneSeparator />
          </>
        )}

        <Panel id="agents-main" minSize={isMobile ? 200 : 400}>
          <div
            className={cn(
              "h-full flex flex-col overflow-hidden bg-surface",
              showCollapsedRail && "ml-12",
            )}
          >
            <ProviderKeyNotice />
            {/* min-h-0 so the notice takes its band out of the section's height
                instead of pushing its bottom past the clipped container. */}
            <div className="min-h-0 flex-1">
              {section === "catalog" ? (
                <CatalogView onUseTemplate={handleNewAgent} />
              ) : section === "skills" ? (
                <SkillsView onNewSkill={handleNewSkill} creatingSkill={creatingSkill} />
              ) : section === "automations" ? (
                <AutomationsView onNewAutomation={handleNewAutomation} />
              ) : (
                <AgentsView onNewAgent={handleNewAgent} />
              )}
            </div>
          </div>
        </Panel>
      </Group>

      {sidebarAsDrawer && (
        <Drawer
          open={showSidebar}
          onClose={() => dispatch(setSidebarCollapsed(true))}
          side="left"
          className="w-72"
          ariaLabel="Agents sidebar"
        >
          {sidebar}
        </Drawer>
      )}

      <CreateAgentModal
        open={createAgentOpen}
        initialTemplateKey={createAgentTemplateKey}
        onClose={() => setCreateAgentOpen(false)}
      />
      <CreateTaskModal open={createTaskOpen} onClose={() => setCreateTaskOpen(false)} />
    </div>
  );
}
