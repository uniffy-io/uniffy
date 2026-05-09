/**
 * AgentsLayout - Main layout for the Agents feature.
 *
 * Structure:
 * - Left sidebar: Navigation tabs grouped by category (toggle-controlled, resizable)
 * - Main content: Active view based on selected tab
 *
 * The sidebar is either expanded or collapsed, controlled by a single toggle
 * button. When collapsed, an icon rail with hover-to-expand overlay is shown
 * via the shared CollapsibleSidebarRail component.
 *
 * Supports:
 * - Zen Mode (full screen, hides sidebar)
 * - Collapsed icon rail with hover-to-expand overlay
 * - Persistent resizable sidebar width via panelStorage
 */

import { useState, useCallback, useMemo } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  ChatCircle,
  Plugs,
  ChatsCircle,
  ChartBar,
  ClockCounterClockwise,
  Robot,
  Lightning,
  Notebook,
  Key,
} from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { loadPanelLayout, savePanelLayout } from "@/shared/utils/panelStorage";
import {
  selectActiveTab,
  selectSidebarCollapsed,
  type AgentsTab,
} from "@/features/agents/store/agentsUiSlice";
import { useAppDispatch } from "@/app/hooks";
import { toggleSidebar } from "@/features/agents/store/agentsUiSlice";
import { useShortcutHandler } from "@/features/settings";
import { AgentsSidebar } from "@/features/agents/components/layout/AgentsSidebar";
import { ChatView } from "@/features/agents/components/views/ChatView";
import { IntegrationsView } from "@/features/agents/components/views/IntegrationsView";
import { ConversationsView } from "@/features/agents/components/views/ConversationsView";
import { UsageView } from "@/features/agents/components/views/UsageView";
import { AutomationsView } from "@/features/agents/components/views/AutomationsView";
import { AgentsView } from "@/features/agents/components/views/AgentsView";
import { SkillsView } from "@/features/agents/components/views/SkillsView";
import { PromptsView } from "@/features/agents/components/views/PromptsView";
import { ConfigView } from "@/features/agents/components/views/ConfigView";
import {
  CollapsibleSidebarRail,
  type SidebarSection,
} from "@/components/layout/CollapsibleSidebarRail";

/**
 * Build sections for the collapsed rail from agent nav tabs.
 * Each icon navigates to the corresponding tab on click.
 */
function useAgentsSections(): SidebarSection[] {
  const navigate = useNavigate();
  const activeTab = useAppSelector(selectActiveTab);

  return useMemo(() => [
    { id: "chat", icon: ChatCircle, label: "Chat", isActive: activeTab === "chat", onClick: () => navigate("/agents/chat") },
    { id: "agents", icon: Robot, label: "Agents", isActive: activeTab === "agents", onClick: () => navigate("/agents/agents") },
    { id: "skills", icon: Lightning, label: "Skills", isActive: activeTab === "skills", onClick: () => navigate("/agents/skills") },
    { id: "prompts", icon: Notebook, label: "Prompts", isActive: activeTab === "prompts", onClick: () => navigate("/agents/prompts") },
    { id: "usage", icon: ChartBar, label: "Usage", isActive: activeTab === "usage", onClick: () => navigate("/agents/usage") },
    { id: "integrations", icon: Plugs, label: "Integrations", isActive: activeTab === "integrations", onClick: () => navigate("/agents/integrations") },
    { id: "conversations", icon: ChatsCircle, label: "Conversations", isActive: activeTab === "conversations", onClick: () => navigate("/agents/conversations") },
    { id: "automations", icon: ClockCounterClockwise, label: "Automations", isActive: activeTab === "automations", onClick: () => navigate("/agents/automations") },
    { id: "config", icon: Key, label: "Keys", isActive: activeTab === "config", onClick: () => navigate("/agents/config") },
  ], [activeTab, navigate]);
}

/**
 * Render the active view component based on the current tab.
 */
function renderView(tab: AgentsTab) {
  switch (tab) {
    case "agents":
      return <AgentsView />;
    case "skills":
      return <SkillsView />;
    case "prompts":
      return <PromptsView />;
    case "config":
      return <ConfigView />;
    case "chat":
      return <ChatView />;
    case "integrations":
      return <IntegrationsView />;
    case "conversations":
      return <ConversationsView />;
    case "usage":
      return <UsageView />;
    case "automations":
      return <AutomationsView />;
  }
}

export function AgentsLayout() {
  const dispatch = useAppDispatch();
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const activeTab = useAppSelector(selectActiveTab);
  const sidebarCollapsed = useAppSelector(selectSidebarCollapsed);
  const agentsSections = useAgentsSections();

  const [defaultLayout] = useState(() => loadPanelLayout("agents-nav"));

  const handleLayoutChange = useCallback(
    (layout: Record<string, number>) => {
      savePanelLayout("agents-nav", layout);
    },
    [],
  );

  const handleExpandSidebar = useCallback(() => {
    dispatch(toggleSidebar());
  }, [dispatch]);

  useShortcutHandler("app.toggleSidebar", handleExpandSidebar);

  const showSidebar = !isZenMode && !sidebarCollapsed;
  const showCollapsedRail = !isZenMode && sidebarCollapsed;

  return (
    <div
      className={cn(
        "relative flex flex-col bg-background text-foreground overflow-hidden",
        "transition-[height] duration-300 ease-in-out",
        isZenMode ? "h-dvh delay-150" : "h-[calc(100dvh-3rem)] delay-0"
      )}
    >
      {/* Collapsed icon rail with hover-to-expand overlay */}
      {showCollapsedRail && (
        <div className="absolute inset-y-0 left-0 z-30 w-12">
          <CollapsibleSidebarRail
            onExpand={handleExpandSidebar}
            sections={agentsSections}
          >
            <AgentsSidebar collapsed={false} />
          </CollapsibleSidebarRail>
        </div>
      )}

      <Group
        orientation="horizontal"
        className="h-full w-full flex"
        defaultLayout={defaultLayout}
        onLayoutChange={handleLayoutChange}
      >
        {/* Expanded resizable sidebar */}
        {showSidebar && (
          <>
            <Panel
              id="agents-nav"
              defaultSize={220}
              minSize={160}
              maxSize={320}
              className="bg-background border-r border-border overflow-hidden"
            >
              <AgentsSidebar collapsed={false} />
            </Panel>

            <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />
          </>
        )}

        {/* Main content */}
        <Panel id="agents-main" minSize={400}>
          <div
            className={cn(
              "h-full flex flex-col overflow-hidden",
              showCollapsedRail && "ml-12"
            )}
          >
            {renderView(activeTab)}
          </div>
        </Panel>
      </Group>
    </div>
  );
}
