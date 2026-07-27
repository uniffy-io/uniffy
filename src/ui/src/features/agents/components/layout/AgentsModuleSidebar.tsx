import { useContext, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CaretDoubleLeft,
  CaretDoubleRight,
  CaretDown,
  CaretRight,
  Lightning,
  MagnifyingGlass,
  Plus,
  Timer,
  Tray,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SidebarOverlayContext } from "@/components/layout/SidebarOverlayContext";
import { AccessModeIcon } from "@/features/permissions";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";
import { SkillSource } from "@uniffy/proto/agents/v1/skills_pb";
import { AgentAvatar } from "@/features/agents/components/AgentAvatar";
import {
  selectSidebarSearch,
  setSidebarSearch,
  toggleSidebar,
} from "@/features/agents/store/agentsUiSlice";
import { selectAllAgents } from "@/features/agents/store/agentsSlice";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";
import { selectAllSkills } from "@/features/agents/store/agentSkillsSlice";
import type { SerializedSkill } from "@/features/agents/store/agentSkillsThunks";
import { selectInboxCount } from "@/features/agents/store/agentSkillDraftsSlice";
import { selectCronTasksList } from "@/features/agents/store/agentCronSlice";
import type { SerializedCronTask } from "@/features/agents/store/agentCronThunks";

interface AgentsModuleSidebarProps {
  onNewAgent: () => void;
  onNewSkill: () => void;
  onNewAutomation: () => void;
}

interface SectionHeaderProps {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  onAdd?: () => void;
  addLabel?: string;
  addTestId?: string;
  testId?: string;
}

function SectionHeader({ label, collapsed, onToggle, onAdd, addLabel, addTestId, testId }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between w-full px-3 py-1.5 group">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 text-xs uppercase font-medium tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        data-testid={testId}
      >
        {collapsed ? <CaretRight size={10} /> : <CaretDown size={10} />}
        {label}
      </button>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label={addLabel}
          title={addLabel}
          className="text-muted-foreground opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:text-foreground"
          data-testid={addTestId}
        >
          <Plus size={14} />
        </button>
      )}
    </div>
  );
}

function BucketLabel({ label }: { label: string }) {
  return (
    <div className="px-3 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/70">
      {label}
    </div>
  );
}

function SidebarRow({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      data-active={active ? "true" : "false"}
      className={cn(
        "flex items-center gap-2 w-full min-w-0 px-3 py-1.5 mx-1.5 rounded-md cursor-pointer text-left text-sm transition-colors",
        "max-w-[calc(100%-12px)]",
        active
          ? "bg-primary/10 text-primary font-medium"
          : "text-foreground/90 hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function AgentRow({ agent, active, onClick }: { agent: SerializedAgent; active: boolean; onClick: () => void }) {
  return (
    <SidebarRow active={active} onClick={onClick} testId={`agents-sidebar-agent-${agent.id}`}>
      <AgentAvatar
        avatarKey={agent.avatarKey}
        avatarEmoji={agent.avatarEmoji}
        agentName={agent.name}
        size="sm"
      />
      <span className="flex-1 min-w-0 truncate">{agent.name}</span>
      {agent.isDefault && (
        <Badge variant="default" className="shrink-0 px-1.5 py-0 text-[10px]">default</Badge>
      )}
      <AccessModeIcon
        mode={agent.accessMode}
        size={13}
        className="shrink-0 text-muted-foreground"
      />
    </SidebarRow>
  );
}

function SkillRow({ skill, active, onClick }: { skill: SerializedSkill; active: boolean; onClick: () => void }) {
  return (
    <SidebarRow active={active} onClick={onClick} testId={`agents-sidebar-skill-${skill.id}`}>
      <Lightning size={14} className="shrink-0 text-muted-foreground" />
      <span className="flex-1 min-w-0 truncate">{skill.displayName || skill.name}</span>
      {skill.alwaysActive && (
        <span
          className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0"
          title="Always active"
        />
      )}
    </SidebarRow>
  );
}

function AutomationRow({ task, active, onClick }: { task: SerializedCronTask; active: boolean; onClick: () => void }) {
  const failed = !task.isEnabled && task.consecutiveFailures >= task.maxConsecutiveFailures;
  const nextRun = task.isEnabled && task.nextRunAt
    ? formatRelativeTime(new Date(task.nextRunAt.seconds * 1000).toISOString())
    : null;
  return (
    <SidebarRow active={active} onClick={onClick} testId={`agents-sidebar-automation-${task.id}`}>
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full shrink-0",
          failed ? "bg-red-500" : task.isEnabled ? "bg-green-500" : "bg-muted-foreground/40",
        )}
        title={failed ? "Auto-disabled" : task.isEnabled ? "Active" : "Paused"}
      />
      <span className="flex-1 min-w-0 truncate">{task.name}</span>
      {nextRun && (
        <span className="text-[10px] text-muted-foreground shrink-0">{nextRun}</span>
      )}
    </SidebarRow>
  );
}

const SKILL_BUCKETS = [
  { source: SkillSource.BUNDLED, label: "Bundled" },
  { source: SkillSource.ORGANIZATION, label: "Organization" },
] as const;

export function AgentsModuleSidebar({ onNewAgent, onNewSkill, onNewAutomation }: AgentsModuleSidebarProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const isOverlay = useContext(SidebarOverlayContext);
  const { tab, subId } = useParams<{ tab?: string; subId?: string }>();

  const search = useAppSelector(selectSidebarSearch);
  const agentsMap = useAppSelector(selectAllAgents);
  const skillsMap = useAppSelector(selectAllSkills);
  const tasks = useAppSelector(selectCronTasksList);
  const draftCount = useAppSelector(selectInboxCount);

  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const toggleSection = (id: string) =>
    setCollapsedSections((prev) => ({ ...prev, [id]: !prev[id] }));

  const query = search.trim().toLowerCase();

  const filteredAgents = useMemo(() => {
    const agents = Object.values(agentsMap);
    return query ? agents.filter((a) => a.name.toLowerCase().includes(query)) : agents;
  }, [agentsMap, query]);

  const skillsByBucket = useMemo(() => {
    const buckets = new Map<number, SerializedSkill[]>();
    for (const skill of Object.values(skillsMap)) {
      const label = skill.displayName || skill.name;
      if (query && !label.toLowerCase().includes(query)) continue;
      const list = buckets.get(skill.source) ?? [];
      list.push(skill);
      buckets.set(skill.source, list);
    }
    return buckets;
  }, [skillsMap, query]);

  const filteredTasks = useMemo(
    () => (query ? tasks.filter((t) => t.name.toLowerCase().includes(query)) : tasks),
    [tasks, query],
  );

  const activeAgentId = tab === "agents" ? subId : undefined;
  const activeSkillId = tab === "skills" && subId !== "drafts" ? subId : undefined;
  const draftsActive = tab === "skills" && subId === "drafts";
  const activeTaskId = tab === "automations" ? subId : undefined;

  return (
    <div className="flex flex-col h-full" data-testid="agents-module-sidebar">
      <div className="flex items-center px-3 pt-3 pb-1">
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => dispatch(toggleSidebar())}
          className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors shrink-0 cursor-pointer"
          title={isOverlay ? "Pin sidebar" : "Collapse sidebar"}
          data-testid="agents-sidebar-collapse-toggle"
        >
          {isOverlay
            ? <CaretDoubleRight size={16} weight="bold" className="text-primary" />
            : <CaretDoubleLeft size={16} weight="bold" className="text-primary" />}
        </button>
      </div>

      <div className="px-3 py-2">
        <div className="relative">
          <MagnifyingGlass
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => dispatch(setSidebarSearch(e.target.value))}
            className="h-7 pl-8 text-xs bg-muted/50"
            data-testid="agents-sidebar-search"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-2">
        <div data-testid="agents-sidebar-agents-section">
          <SectionHeader
            label="Agents"
            collapsed={!!collapsedSections.agents}
            onToggle={() => toggleSection("agents")}
            onAdd={onNewAgent}
            addLabel="New agent"
            addTestId="agents-sidebar-new-agent-button"
            testId="agents-sidebar-agents-toggle"
          />
          {!collapsedSections.agents && (
            <div className="space-y-px">
              {filteredAgents.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  active={agent.id === activeAgentId}
                  onClick={() => navigate(`/agents/agents/${agent.id}/overview`)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mx-3 my-2 h-px bg-border/60" role="separator" />

        <div data-testid="agents-sidebar-skills-section">
          <SectionHeader
            label="Skills"
            collapsed={!!collapsedSections.skills}
            onToggle={() => toggleSection("skills")}
            onAdd={onNewSkill}
            addLabel="New skill"
            addTestId="agents-sidebar-new-skill-button"
            testId="agents-sidebar-skills-toggle"
          />
          {!collapsedSections.skills && (
            <div className="space-y-px">
              {SKILL_BUCKETS.map(({ source, label }) => {
                const bucketSkills = skillsByBucket.get(source) ?? [];
                if (bucketSkills.length === 0) return null;
                return (
                  <div key={source}>
                    <BucketLabel label={label} />
                    {bucketSkills.map((skill) => (
                      <SkillRow
                        key={skill.id}
                        skill={skill}
                        active={skill.id === activeSkillId}
                        onClick={() => navigate(`/agents/skills/${skill.id}`)}
                      />
                    ))}
                  </div>
                );
              })}
              <SidebarRow
                active={draftsActive}
                onClick={() => navigate("/agents/skills/drafts")}
                testId="agents-sidebar-skill-drafts-row"
              >
                <Tray size={14} className="shrink-0 text-muted-foreground" />
                <span className="flex-1 min-w-0 truncate">Drafts</span>
                {draftCount > 0 && (
                  <Badge className="bg-primary/10 text-primary border-transparent px-1.5 py-0 text-[10px]">
                    {draftCount}
                  </Badge>
                )}
              </SidebarRow>
            </div>
          )}
        </div>

        <div className="mx-3 my-2 h-px bg-border/60" role="separator" />

        <div data-testid="agents-sidebar-automations-section">
          <SectionHeader
            label="Automations"
            collapsed={!!collapsedSections.automations}
            onToggle={() => toggleSection("automations")}
            onAdd={onNewAutomation}
            addLabel="New automation"
            addTestId="agents-sidebar-new-automation-button"
            testId="agents-sidebar-automations-toggle"
          />
          {!collapsedSections.automations && (
            <div className="space-y-px">
              {filteredTasks.length === 0 ? (
                <div className="px-3 py-1.5 text-xs text-muted-foreground flex items-center gap-2">
                  <Timer size={14} />
                  No automations yet
                </div>
              ) : (
                filteredTasks.map((task) => (
                  <AutomationRow
                    key={task.id}
                    task={task}
                    active={task.id === activeTaskId}
                    onClick={() => navigate(`/agents/automations/${task.id}`)}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
