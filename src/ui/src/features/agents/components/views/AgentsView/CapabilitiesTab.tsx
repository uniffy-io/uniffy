import { useCallback, useEffect, useMemo, useState } from "react";
import { CaretDown, CaretRight, CircleNotch, WarningCircle } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useMyContentRole } from "@/features/permissions";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { roleCanEdit } from "@/shared/utils/contentRoles";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Select } from "@/components/ui/select";
import type { ToolGroup, ToolCategorySection } from "@/features/agents/config/toolCatalog";
import { toolSummary } from "@/features/agents/config/toolLabels";
import { selectAllSkills, selectSkillsLoading } from "@/features/agents/store/agentSkillsSlice";
import { fetchSkills } from "@/features/agents/store/agentSkillsThunks";
import { SkillCompatibilityNotice } from "@/features/agents/components/skills/SkillCompatibilityNotice";
import {
  fetchSkillCompatibility,
  type SerializedSkillCompatibility,
} from "@/features/agents/store/agentRunnableSkillsThunks";
import {
  selectSkillCompatibility,
  selectSkillCompatibilityStatus,
} from "@/features/agents/store/agentRunnableSkillsSlice";
import {
  selectToolSections,
  selectAgentToolsLoading,
} from "@/features/agents/store/agentToolsSlice";
import { fetchAgentTools } from "@/features/agents/store/agentToolsThunks";
import { selectIntegrationConnections } from "@/features/integrations/store/integrationsSlice";
import type { ConnectionPlain } from "@/features/integrations/store/integrationsThunks";
import { integrationLabel } from "@/features/integrations/config/integrationBrands";
import { updateAgent } from "@/features/agents/store/agentsThunks";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";
import type { SerializedSkill } from "@/features/agents/store/agentSkillsThunks";
import { SkillSource } from "@uniffy/proto/agents/v1/skills_pb";
import { RuleSource, RuleStatus } from "@uniffy/proto/agents/v1/rules_pb";
import {
  fetchRules,
  setEnabledRules,
  type SerializedRule,
} from "@/features/agents/store/agentRulesThunks";

const listRowClass = "flex items-center gap-3 py-2 border-b border-border/60 last:border-0";

function ToolGroupRows({
  group,
  enabledTools,
  connectedProviders,
  usableConnections,
  pinnedConnections,
  disabled,
  onToggle,
  onToggleAll,
  onPinConnection,
}: {
  group: ToolGroup;
  enabledTools: Set<string>;
  connectedProviders: Set<string>;
  usableConnections: ConnectionPlain[];
  pinnedConnections: Record<string, string>;
  disabled?: boolean;
  onToggle: (toolName: string, enabled: boolean) => void;
  onToggleAll: (groupTools: string[], enabled: boolean) => void;
  onPinConnection: (providerId: string, connectionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const providerId = group.requiresConnection;
  const missingConnection = providerId !== undefined && !connectedProviders.has(providerId);

  const providerConnections = useMemo(
    () => (providerId ? usableConnections.filter((c) => c.provider === providerId) : []),
    [usableConnections, providerId],
  );
  const pinnedId = providerId !== undefined ? (pinnedConnections[providerId] ?? "") : "";
  const pinnedMissing = pinnedId !== "" && !providerConnections.some((c) => c.id === pinnedId);
  const showConnectionPicker = providerId !== undefined;
  const connectionOptions = useMemo(
    () => [
      { value: "", label: "Automatic" },
      ...providerConnections.map((c) => ({ value: c.id, label: c.name })),
    ],
    [providerConnections],
  );

  const groupToolNames = useMemo(() => group.tools.map((t) => t.name), [group.tools]);
  const enabledInGroup = useMemo(
    () => groupToolNames.filter((name) => enabledTools.has(name)).length,
    [groupToolNames, enabledTools],
  );
  const allEnabled = enabledInGroup === group.tools.length;

  return (
    <div>
      <div className={listRowClass}>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-muted-foreground hover:text-foreground transition-colors"
          data-testid={`capabilities-group-expand-${group.group}`}
          data-state={expanded ? "open" : "closed"}
        >
          {expanded ? <CaretDown size={16} /> : <CaretRight size={16} />}
        </button>
        <div className="flex flex-1 min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-sm font-medium text-foreground">{group.group}</span>
          {showConnectionPicker && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Connection</span>
              <Select
                size="sm"
                value={pinnedMissing ? "" : pinnedId}
                onChange={(value) => onPinConnection(providerId, value)}
                options={connectionOptions}
                disabled={disabled}
              />
            </div>
          )}
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {enabledInGroup}/{group.tools.length}
        </span>
        <ToggleSwitch
          size="sm"
          enabled={allEnabled}
          disabled={disabled}
          onChange={() => onToggleAll(groupToolNames, !allEnabled)}
        />
      </div>
      {showConnectionPicker && pinnedMissing && (
        <p className="pl-7 py-1 text-xs text-muted-foreground">
          Pinned connection no longer exists
        </p>
      )}
      {missingConnection && (
        <p className="pl-7 py-1 text-xs text-muted-foreground">
          {`No ${integrationLabel(group.requiresConnection)} connection. An org admin can add one under Admin > Integrations.`}
        </p>
      )}
      {expanded && (
        <div className="pl-7">
          {group.tools.map((tool) => (
            <div key={tool.name} className={listRowClass}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{tool.displayName}</span>
                  {tool.destructive && (
                    <WarningCircle size={14} weight="fill" className="text-yellow-500 shrink-0" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5" title={tool.description}>
                  {toolSummary(tool.description)}
                </p>
              </div>
              <ToggleSwitch
                size="sm"
                enabled={enabledTools.has(tool.name)}
                disabled={disabled}
                onChange={() => onToggle(tool.name, !enabledTools.has(tool.name))}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ToolCategory({
  section,
  enabledTools,
  connectedProviders,
  usableConnections,
  pinnedConnections,
  enabledCount,
  totalCount,
  disabled,
  onToggle,
  onToggleAll,
  onPinConnection,
}: {
  section: ToolCategorySection;
  enabledTools: Set<string>;
  connectedProviders: Set<string>;
  usableConnections: ConnectionPlain[];
  pinnedConnections: Record<string, string>;
  enabledCount: number;
  totalCount: number;
  disabled?: boolean;
  onToggle: (toolName: string, enabled: boolean) => void;
  onToggleAll: (groupTools: string[], enabled: boolean) => void;
  onPinConnection: (providerId: string, connectionId: string) => void;
}) {
  return (
    <section className="border-b border-border pb-6">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
            {section.label}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">{section.description}</p>
        </div>
        <span className="text-sm text-muted-foreground tabular-nums">
          {enabledCount}/{totalCount} enabled
        </span>
      </div>
      {section.groups.map((group) => (
        <ToolGroupRows
          key={group.group}
          group={group}
          enabledTools={enabledTools}
          connectedProviders={connectedProviders}
          usableConnections={usableConnections}
          pinnedConnections={pinnedConnections}
          disabled={disabled}
          onToggle={onToggle}
          onToggleAll={onToggleAll}
          onPinConnection={onPinConnection}
        />
      ))}
    </section>
  );
}

function RuleRow({
  rule,
  enabled,
  disabled,
  onToggle,
}: {
  rule: SerializedRule;
  enabled: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const retired = rule.status === RuleStatus.RETIRED;
  return (
    <div className={listRowClass} data-testid={`capabilities-rule-${rule.id}`}>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium truncate text-foreground block">
          {rule.displayName}
        </span>
        <p className="text-xs text-muted-foreground truncate">
          {retired ? "Retired. Stays on until turned off." : rule.description}
        </p>
      </div>
      <ToggleSwitch
        size="sm"
        enabled={enabled}
        disabled={disabled || (retired && !enabled)}
        onChange={onToggle}
      />
    </div>
  );
}

function SkillRow({
  skill,
  enabled,
  disabled,
  diagnostic,
  toolLabels,
  onToggle,
}: {
  skill: SerializedSkill;
  enabled: boolean;
  disabled?: boolean;
  diagnostic?: SerializedSkillCompatibility;
  toolLabels: Record<string, string>;
  onToggle: () => void;
}) {
  return (
    <div className={listRowClass}>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium truncate text-foreground block">
          {skill.displayName}
        </span>
        <p className="text-xs text-muted-foreground truncate">{skill.description}</p>
        {skill.status === "retired" && (
          <p className="mt-1 text-xs text-muted-foreground">
            {enabled
              ? "Retired. Remains available until unassigned."
              : "Retired skills cannot be assigned."}
          </p>
        )}
        {enabled && <SkillCompatibilityNotice diagnostic={diagnostic} toolLabels={toolLabels} />}
      </div>
      <ToggleSwitch
        size="sm"
        enabled={enabled}
        disabled={disabled || (skill.status === "retired" && !enabled)}
        onChange={onToggle}
      />
    </div>
  );
}

function CapabilityGroup({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div>
      <div className="flex items-center gap-2 py-2 border-b border-border/60">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {collapsed ? <CaretRight size={16} /> : <CaretDown size={16} />}
        </button>
        <span className="text-xs uppercase tracking-wider text-muted-foreground flex-1">
          {title}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
      </div>
      {!collapsed && children}
    </div>
  );
}

export function CapabilitiesTab({ agent }: { agent: SerializedAgent }) {
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const diagnostics = useAppSelector(selectSkillCompatibility(agent.id));
  const diagnosticStatus = useAppSelector(selectSkillCompatibilityStatus(agent.id));
  const skillsMap = useAppSelector(selectAllSkills);
  const skillsLoading = useAppSelector(selectSkillsLoading);
  const myRole = useMyContentRole(ContentType.AGENT, agent.id, agent.userRole);
  // A deleted agent is a historical record: readable, never editable.
  const canEdit = roleCanEdit(myRole) && !agent.isDeleted;

  const skills = useMemo(() => Object.values(skillsMap), [skillsMap]);
  const connections = useAppSelector(selectIntegrationConnections);
  const toolSections = useAppSelector(selectToolSections);
  const toolsLoading = useAppSelector(selectAgentToolsLoading);
  const diagnosticsById = useMemo(
    () => Object.fromEntries(diagnostics.map((item) => [item.skillId, item])),
    [diagnostics],
  );
  const toolLabels = useMemo(
    () =>
      Object.fromEntries(
        toolSections.flatMap((section) =>
          section.groups.flatMap((group) =>
            group.tools.map((tool) => [tool.name, tool.displayName]),
          ),
        ),
      ),
    [toolSections],
  );

  useEffect(() => {
    if (organizationId && !agent.isDeleted) {
      dispatch(fetchSkillCompatibility({ organizationId, agentId: agent.id }));
    }
  }, [
    dispatch,
    organizationId,
    agent.id,
    agent.isDeleted,
    agent.enabledSkills,
    agent.enabledTools,
    agent.imageModel,
    agent.integrationConnections,
    skillsMap,
    connections,
  ]);

  const rulesMap = useAppSelector((s) => s.agentRules.rules);
  const rulesLoading = useAppSelector((s) => s.agentRules.loading);
  const ruleSelecting = useAppSelector((s) => s.agentRules.selecting[agent.id] ?? false);

  useEffect(() => {
    dispatch(fetchSkills());
    dispatch(fetchAgentTools());
    dispatch(fetchRules());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const usableConnections = useMemo(
    () => connections.filter((c) => c.isValid && c.isEnabled),
    [connections],
  );

  const connectedProviders = useMemo(
    () => new Set(usableConnections.map((c) => c.provider)),
    [usableConnections],
  );

  const enabledTools = useMemo(() => new Set(agent.enabledTools), [agent.enabledTools]);

  const sectionCounts = useMemo(() => {
    const counts: Record<string, { enabled: number; total: number }> = {};
    for (const section of toolSections) {
      let total = 0;
      let enabled = 0;
      for (const group of section.groups) {
        total += group.tools.length;
        enabled += group.tools.filter((t) => enabledTools.has(t.name)).length;
      }
      counts[section.category] = { enabled, total };
    }
    return counts;
  }, [enabledTools, toolSections]);

  const handleToolToggle = useCallback(
    (toolName: string, enabled: boolean) => {
      const updated = enabled
        ? [...agent.enabledTools, toolName]
        : agent.enabledTools.filter((t) => t !== toolName);
      dispatch(updateAgent({ agentId: agent.id, enabledTools: updated }));
    },
    [agent.id, agent.enabledTools, dispatch],
  );

  const handleToolToggleAll = useCallback(
    (groupTools: string[], enabled: boolean) => {
      const current = new Set(agent.enabledTools);
      for (const tool of groupTools) {
        if (enabled) {
          current.add(tool);
        } else {
          current.delete(tool);
        }
      }
      dispatch(updateAgent({ agentId: agent.id, enabledTools: [...current] }));
    },
    [agent.id, agent.enabledTools, dispatch],
  );

  const handlePinConnection = useCallback(
    (providerId: string, connectionId: string) => {
      const updated = { ...agent.integrationConnections };
      if (connectionId) {
        updated[providerId] = connectionId;
      } else {
        delete updated[providerId];
      }
      dispatch(updateAgent({ agentId: agent.id, integrationConnections: updated }));
    },
    [agent.id, agent.integrationConnections, dispatch],
  );

  const enabledSkillIds = useMemo(() => new Set(agent.enabledSkills), [agent.enabledSkills]);
  const unlistedAssignments = diagnostics.filter((item) => !skillsMap[item.skillId]);

  const bundledSkills = useMemo(
    () => skills.filter((s) => s.source === SkillSource.BUNDLED),
    [skills],
  );
  const orgSkills = useMemo(
    () => skills.filter((s) => s.source === SkillSource.ORGANIZATION),
    [skills],
  );

  const handleSkillToggle = useCallback(
    (skillId: string) => {
      const updated = enabledSkillIds.has(skillId)
        ? agent.enabledSkills.filter((id) => id !== skillId)
        : [...agent.enabledSkills, skillId];
      dispatch(updateAgent({ agentId: agent.id, enabledSkills: updated }));
    },
    [agent.id, agent.enabledSkills, enabledSkillIds, dispatch],
  );

  const enabledRuleIds = useMemo(() => new Set(agent.enabledRules), [agent.enabledRules]);

  // Retired rules drop out of the list unless this agent still carries them,
  // since they can be turned off but never newly enabled.
  const visibleRules = useMemo(
    () =>
      Object.values(rulesMap).filter(
        (rule) => rule.status === RuleStatus.ACTIVE || enabledRuleIds.has(rule.id),
      ),
    [rulesMap, enabledRuleIds],
  );
  const bundledRules = useMemo(
    () => visibleRules.filter((r) => r.source === RuleSource.BUNDLED),
    [visibleRules],
  );
  const orgRules = useMemo(
    () => visibleRules.filter((r) => r.source === RuleSource.ORGANIZATION),
    [visibleRules],
  );

  const handleRuleToggle = useCallback(
    (ruleId: string) => {
      const ruleIds = enabledRuleIds.has(ruleId)
        ? agent.enabledRules.filter((id) => id !== ruleId)
        : [...agent.enabledRules, ruleId];
      dispatch(setEnabledRules({ agentId: agent.id, ruleIds }));
    },
    [agent.id, agent.enabledRules, enabledRuleIds, dispatch],
  );

  const renderRuleRows = (rules: SerializedRule[], emptyLabel: string) => (
    <div>
      {rules.map((rule) => (
        <RuleRow
          key={rule.id}
          rule={rule}
          enabled={enabledRuleIds.has(rule.id)}
          disabled={!canEdit || ruleSelecting}
          onToggle={() => handleRuleToggle(rule.id)}
        />
      ))}
      {rules.length === 0 && <p className="py-2 text-sm text-muted-foreground">{emptyLabel}</p>}
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <section className="border-b border-border pb-6">
        <div className="mb-2">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Rules</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Select the rules appended to this agent’s runs. Rules are never inherited from other
            agents.
          </p>
        </div>

        {rulesLoading && visibleRules.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <CircleNotch size={24} className="animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <CapabilityGroup title="Bundled" count={bundledRules.length}>
              {renderRuleRows(bundledRules, "No bundled rules available")}
            </CapabilityGroup>
            <CapabilityGroup title="Organization" count={orgRules.length}>
              {renderRuleRows(orgRules, "No organization rules available")}
            </CapabilityGroup>
          </div>
        )}
      </section>
      {toolSections.length === 0 && toolsLoading && (
        <div className="flex items-center justify-center py-8">
          <CircleNotch size={20} className="animate-spin text-muted-foreground" />
        </div>
      )}
      {toolSections.map((section) => {
        const counts = sectionCounts[section.category] ?? { enabled: 0, total: 0 };
        return (
          <ToolCategory
            key={section.category}
            section={section}
            enabledTools={enabledTools}
            connectedProviders={connectedProviders}
            usableConnections={usableConnections}
            pinnedConnections={agent.integrationConnections}
            enabledCount={counts.enabled}
            totalCount={counts.total}
            disabled={!canEdit}
            onToggle={handleToolToggle}
            onToggleAll={handleToolToggleAll}
            onPinConnection={handlePinConnection}
          />
        );
      })}

      <section>
        <div className="mb-2">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
            Available skills
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Choose which skills people can explicitly invoke on this agent
          </p>
          {diagnosticStatus === "loading" && (
            <p className="mt-1 text-xs text-muted-foreground">Checking skill requirements…</p>
          )}
          {diagnosticStatus === "failed" && (
            <p className="mt-1 text-xs text-muted-foreground">
              Skill requirements could not be checked. They will be checked again when invoked.
            </p>
          )}
        </div>

        {skillsLoading && skills.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <CircleNotch size={24} className="animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {unlistedAssignments.length > 0 && (
              <CapabilityGroup title="Assigned" count={unlistedAssignments.length}>
                {unlistedAssignments.map((item) => (
                  <div key={item.skillId} className={listRowClass}>
                    <div className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-foreground">
                        {item.displayName || "Unavailable skill"}
                      </span>
                      {item.retired && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Retired. Remains available until unassigned.
                        </p>
                      )}
                      <SkillCompatibilityNotice diagnostic={item} toolLabels={toolLabels} />
                    </div>
                    <ToggleSwitch
                      size="sm"
                      enabled
                      disabled={!canEdit}
                      onChange={() => handleSkillToggle(item.skillId)}
                    />
                  </div>
                ))}
              </CapabilityGroup>
            )}
            <CapabilityGroup title="Bundled" count={bundledSkills.length}>
              <div>
                {bundledSkills.map((skill) => (
                  <SkillRow
                    key={skill.id}
                    skill={skill}
                    diagnostic={diagnosticsById[skill.id]}
                    toolLabels={toolLabels}
                    enabled={enabledSkillIds.has(skill.id)}
                    disabled={!canEdit}
                    onToggle={() => handleSkillToggle(skill.id)}
                  />
                ))}
                {bundledSkills.length === 0 && (
                  <p className="py-2 text-sm text-muted-foreground">No bundled skills available</p>
                )}
              </div>
            </CapabilityGroup>

            <CapabilityGroup title="Organization" count={orgSkills.length}>
              <div>
                {orgSkills.map((skill) => (
                  <SkillRow
                    key={skill.id}
                    skill={skill}
                    diagnostic={diagnosticsById[skill.id]}
                    toolLabels={toolLabels}
                    enabled={enabledSkillIds.has(skill.id)}
                    disabled={!canEdit}
                    onToggle={() => handleSkillToggle(skill.id)}
                  />
                ))}
                {orgSkills.length === 0 && (
                  <p className="py-2 text-sm text-muted-foreground">
                    No organization skills available
                  </p>
                )}
              </div>
            </CapabilityGroup>
          </div>
        )}
      </section>
    </div>
  );
}
