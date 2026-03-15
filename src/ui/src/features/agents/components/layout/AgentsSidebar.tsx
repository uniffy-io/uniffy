/**
 * AgentsSidebar - Left navigation sidebar for the Agents feature.
 *
 * Two modes controlled by a single toggle button:
 * - Expanded: Full-width with section headers and text labels
 * - Collapsed: Narrow icon rail that expands on hover as an overlay
 */

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
  CaretDoubleRight,
  CaretDoubleLeft,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import {
  selectActiveTab,
  toggleSidebar,
  type AgentsTab,
} from "@/features/agents/store/agentsUiSlice";

interface NavItem {
  id: AgentsTab;
  label: string;
  icon: Icon;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Chat",
    items: [{ id: "chat", label: "Chat", icon: ChatCircle }],
  },
  {
    label: "Agent",
    items: [
      { id: "agents", label: "Agents", icon: Robot },
      { id: "skills", label: "Skills", icon: Lightning },
      { id: "prompts", label: "Prompts", icon: Notebook },
    ],
  },
  {
    label: "Monitor",
    items: [
      { id: "usage", label: "Usage", icon: ChartBar },
      { id: "integrations", label: "Integrations", icon: Plugs },
      { id: "conversations", label: "Conversations", icon: ChatsCircle },
      { id: "automations", label: "Automations", icon: ClockCounterClockwise },
    ],
  },
  {
    label: "Config",
    items: [{ id: "config", label: "Keys", icon: Key }],
  },
];

interface AgentsSidebarProps {
  collapsed?: boolean;
}

export function AgentsSidebar({ collapsed = false }: AgentsSidebarProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const activeTab = useAppSelector(selectActiveTab);

  // Expanded mode (full sidebar with labels)
  if (!collapsed) {
    return (
      <div className="h-full flex flex-col bg-card overflow-y-auto">
        {/* Header with collapse toggle */}
        <div className="flex items-center px-3 pt-3 pb-1">
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => dispatch(toggleSidebar())}
            className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors shrink-0 cursor-pointer"
            title="Collapse sidebar"
          >
            <CaretDoubleLeft size={16} weight="bold" className="text-primary" />
          </button>
        </div>

        <nav className="flex-1 pb-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-3 py-2 mt-2 text-xs uppercase text-muted-foreground font-medium tracking-wider">
                {group.label}
              </div>
              {group.items.map((item) => {
                const isActive = activeTab === item.id;
                const IconComponent = item.icon;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigate(`/agents/${item.id}`)}
                    className={cn(
                      "flex items-center gap-2 w-full px-3 py-1.5 text-sm cursor-pointer transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary border-l-2 border-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground border-l-2 border-transparent"
                    )}
                  >
                    <span className="shrink-0 flex items-center justify-center w-7 h-7 rounded-md">
                      <IconComponent size={20} weight={isActive ? "fill" : "duotone"} />
                    </span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </div>
    );
  }

  // Collapsed mode: icon rail that expands on hover as overlay
  return (
    <div className="group/sidebar h-full relative">
      <div
        className={cn(
          "h-full flex flex-col bg-card overflow-y-auto overflow-x-hidden",
          "w-full group-hover/sidebar:w-48",
          "transition-[width] duration-200 ease-out",
          "group-hover/sidebar:shadow-xl group-hover/sidebar:border-r group-hover/sidebar:border-border"
        )}
      >
        {/* Header with expand toggle */}
        <div className="flex items-center justify-end px-2 pt-3 pb-1">
          <button
            type="button"
            onClick={() => dispatch(toggleSidebar())}
            className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors shrink-0 cursor-pointer"
            title="Expand sidebar"
          >
            <CaretDoubleRight size={16} weight="bold" className="text-primary" />
          </button>
        </div>

        <nav className="flex-1 pb-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              {/* Section divider (collapsed) / label (hover-expanded) */}
              <div className="mt-3 mb-0.5 px-3 h-4 flex items-center">
                <span className="hidden group-hover/sidebar:block text-xs uppercase text-muted-foreground font-medium tracking-wider whitespace-nowrap">
                  {group.label}
                </span>
                <span className="block group-hover/sidebar:hidden w-6 mx-auto border-t border-border" />
              </div>

              {group.items.map((item) => {
                const isActive = activeTab === item.id;
                const IconComponent = item.icon;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigate(`/agents/${item.id}`)}
                    className={cn(
                      "flex items-center w-full cursor-pointer transition-colors",
                      "px-3 py-1.5 gap-2",
                      isActive
                        ? "bg-primary/10 text-primary border-l-2 border-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground border-l-2 border-transparent"
                    )}
                  >
                    <span className="shrink-0 flex items-center justify-center w-7 h-7 rounded-md">
                      <IconComponent
                        size={20}
                        weight={isActive ? "fill" : "duotone"}
                      />
                    </span>

                    <span className="hidden group-hover/sidebar:inline text-sm whitespace-nowrap">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </div>
    </div>
  );
}
