import { useContext } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Books,
  CaretDoubleLeft,
  CaretDoubleRight,
  ClockCounterClockwise,
  Lightning,
  Robot,
  Tray,
  type Icon,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Badge } from "@/components/ui/badge";
import { SidebarOverlayContext } from "@/components/layout/SidebarOverlayContext";
import { toggleSidebar } from "@/features/agents/store/agentsUiSlice";
import { selectInboxCount } from "@/features/agents/store/agentSkillDraftsSlice";

interface NavRowProps {
  icon: Icon;
  label: string;
  badgeCount?: number;
  active: boolean;
  onClick: () => void;
  testId: string;
}

/**
 * One destination, one row. Each section browses in the main panel, so the
 * sidebar's whole job is picking which one.
 */
function NavRow({ icon: RowIcon, label, badgeCount, active, onClick, testId }: NavRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      data-active={active ? "true" : "false"}
      className={cn(
        "flex w-full min-w-0 items-center gap-2.5 rounded-md px-3 py-2 mx-1.5 max-w-[calc(100%-12px)]",
        "cursor-pointer text-left text-sm transition-colors",
        active
          ? "bg-primary/10 text-primary font-medium"
          : "text-foreground/90 hover:bg-accent hover:text-foreground",
      )}
    >
      <RowIcon
        size={16}
        weight={active ? "fill" : "duotone"}
        className={cn("shrink-0", active ? "text-primary" : "text-muted-foreground")}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badgeCount !== undefined && badgeCount > 0 ? (
        <Badge className="shrink-0 border-transparent bg-primary/10 px-1.5 py-0 text-[10px] text-primary">
          {badgeCount}
        </Badge>
      ) : null}
    </button>
  );
}

export function AgentsModuleSidebar() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const isOverlay = useContext(SidebarOverlayContext);
  const { tab, subId } = useParams<{ tab?: string; subId?: string }>();

  const draftCount = useAppSelector(selectInboxCount);

  const section = tab ?? "agents";
  const draftsActive = section === "skills" && subId === "drafts";

  return (
    <div className="flex h-full flex-col" data-testid="agents-module-sidebar">
      <div className="flex items-center px-3 pt-3 pb-2 gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Agents
        </span>
        <button
          type="button"
          onClick={() => dispatch(toggleSidebar())}
          className="shrink-0 cursor-pointer rounded-md bg-transparent p-1.5 transition-colors hover:bg-muted"
          title={isOverlay ? "Pin sidebar" : "Collapse sidebar"}
          data-testid="agents-sidebar-collapse-toggle"
        >
          {isOverlay
            ? <CaretDoubleRight size={16} weight="bold" className="text-primary" />
            : <CaretDoubleLeft size={16} weight="bold" className="text-primary" />}
        </button>
      </div>

      <div className="flex-1 space-y-px overflow-y-auto pb-2">
        <NavRow
          icon={Robot}
          label="Agents"
          active={section === "agents"}
          onClick={() => navigate("/agents/agents")}
          testId="agents-sidebar-nav-agents"
        />
        <NavRow
          icon={Books}
          label="Catalog"
          active={section === "catalog"}
          onClick={() => navigate("/agents/catalog")}
          testId="agents-sidebar-nav-catalog"
        />
        <NavRow
          icon={Lightning}
          label="Skills"
          active={section === "skills" && !draftsActive}
          onClick={() => navigate("/agents/skills")}
          testId="agents-sidebar-nav-skills"
        />
        <NavRow
          icon={Tray}
          label="Skill drafts"
          badgeCount={draftCount}
          active={draftsActive}
          onClick={() => navigate("/agents/skills/drafts")}
          testId="agents-sidebar-nav-drafts"
        />
        <NavRow
          icon={ClockCounterClockwise}
          label="Automations"
          active={section === "automations"}
          onClick={() => navigate("/agents/automations")}
          testId="agents-sidebar-nav-automations"
        />
      </div>
    </div>
  );
}
