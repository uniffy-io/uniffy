/**
 * AgentsLayout - Main layout for the Agents feature.
 *
 * Structure:
 * - Left sidebar: Navigation tabs grouped by category (toggle-controlled, resizable)
 * - Main content: Active view based on selected tab
 *
 * The sidebar is either expanded or collapsed, controlled by a single toggle
 * button. When collapsed, hovering over the icon rail expands it as an overlay.
 * When expanded, the sidebar width is resizable and persisted to localStorage.
 *
 * Supports:
 * - Zen Mode (full screen, hides sidebar)
 * - Collapsed icon rail with hover-to-expand overlay
 * - Persistent resizable sidebar width via panelStorage
 */

import { useState, useCallback } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { loadPanelLayout, savePanelLayout } from "@/shared/utils/panelStorage";
import {
  selectActiveTab,
  selectSidebarCollapsed,
  type AgentsTab,
} from "@/features/agents/store/agentsUiSlice";
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
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const activeTab = useAppSelector(selectActiveTab);
  const sidebarCollapsed = useAppSelector(selectSidebarCollapsed);

  const [defaultLayout] = useState(() => loadPanelLayout("agents-nav"));

  const handleLayoutChange = useCallback(
    (layout: Record<string, number>) => {
      savePanelLayout("agents-nav", layout);
    },
    [],
  );

  const showSidebar = !isZenMode && !sidebarCollapsed;

  return (
    <div
      className={cn(
        "relative flex flex-col bg-background text-foreground overflow-hidden",
        "transition-[height] duration-300 ease-in-out",
        isZenMode ? "h-screen delay-150" : "h-[calc(100vh-4rem)] delay-0"
      )}
    >
      {/* Collapsed icon rail - outside resizable panels */}
      {!isZenMode && sidebarCollapsed && (
        <div className="absolute inset-y-0 left-0 z-30 w-12 bg-card border-r border-border">
          <AgentsSidebar collapsed />
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
              className="bg-card border-r border-border overflow-hidden"
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
              !isZenMode && sidebarCollapsed && "ml-12"
            )}
          >
            {renderView(activeTab)}
          </div>
        </Panel>
      </Group>
    </div>
  );
}
