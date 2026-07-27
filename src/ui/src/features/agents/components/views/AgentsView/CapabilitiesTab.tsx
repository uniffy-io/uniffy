import { useCallback, useEffect, useMemo, useState } from "react";
import {
    CaretDown,
    CaretRight,
    CircleNotch,
    Lock,
    WarningCircle,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useMyContentRole } from "@/features/permissions";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { roleCanEdit } from "@/shared/utils/contentRoles";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { TOOL_SECTIONS } from "@/features/agents/config/toolCatalog";
import type { ToolGroup, ToolCategorySection } from "@/features/agents/config/toolCatalog";
import { selectAllSkills, selectSkillsLoading } from "@/features/agents/store/agentSkillsSlice";
import { fetchSkills } from "@/features/agents/store/agentSkillsThunks";
import { updateAgent } from "@/features/agents/store/agentsThunks";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";
import type { SerializedSkill } from "@/features/agents/store/agentSkillsThunks";
import { SkillSource } from "@uniffy/proto/agents/v1/skills_pb";

const listRowClass = "flex items-center gap-3 py-2 border-b border-border/60 last:border-0";

function ToolGroupRows({
    group,
    enabledTools,
    disabled,
    onToggle,
    onToggleAll,
}: {
    group: ToolGroup;
    enabledTools: Set<string>;
    disabled?: boolean;
    onToggle: (toolName: string, enabled: boolean) => void;
    onToggleAll: (groupTools: string[], enabled: boolean) => void;
}) {
    const [expanded, setExpanded] = useState(false);

    const groupToolNames = useMemo(
        () => group.tools.map((t) => t.name),
        [group.tools]
    );
    const enabledInGroup = useMemo(
        () => groupToolNames.filter((name) => enabledTools.has(name)).length,
        [groupToolNames, enabledTools]
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
                <span className="text-sm font-medium text-foreground flex-1">
                    {group.group}
                </span>
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
            {expanded && (
                <div className="pl-7">
                    {group.tools.map((tool) => (
                        <div key={tool.name} className={listRowClass}>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-foreground">
                                        {tool.displayName}
                                    </span>
                                    {tool.destructive && (
                                        <WarningCircle
                                            size={14}
                                            weight="fill"
                                            className="text-yellow-500 shrink-0"
                                        />
                                    )}
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    {tool.description}
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
    enabledCount,
    totalCount,
    disabled,
    onToggle,
    onToggleAll,
}: {
    section: ToolCategorySection;
    enabledTools: Set<string>;
    enabledCount: number;
    totalCount: number;
    disabled?: boolean;
    onToggle: (toolName: string, enabled: boolean) => void;
    onToggleAll: (groupTools: string[], enabled: boolean) => void;
}) {
    return (
        <section className="border-b border-border pb-6">
            <div className="flex items-center justify-between mb-2">
                <div>
                    <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
                        {section.label}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                        {section.description}
                    </p>
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
                    disabled={disabled}
                    onToggle={onToggle}
                    onToggleAll={onToggleAll}
                />
            ))}
        </section>
    );
}

function SkillToggle({
    enabled,
    locked,
    disabled,
    onChange,
}: {
    enabled: boolean;
    locked: boolean;
    disabled?: boolean;
    onChange: () => void;
}) {
    if (locked) {
        return (
            <div className="flex items-center gap-1.5">
                <Lock size={14} className="text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Always on</span>
            </div>
        );
    }
    return <ToggleSwitch size="sm" enabled={enabled} disabled={disabled} onChange={onChange} />;
}

function SkillRow({
    skill,
    enabled,
    disabled,
    onToggle,
}: {
    skill: SerializedSkill;
    enabled: boolean;
    disabled?: boolean;
    onToggle: () => void;
}) {
    return (
        <div className={listRowClass}>
            <div className="flex-1 min-w-0">
                <span className="text-sm font-medium truncate text-foreground block">
                    {skill.displayName}
                </span>
                <p className="text-xs text-muted-foreground truncate">
                    {skill.description}
                </p>
            </div>
            <SkillToggle
                enabled={enabled || skill.alwaysActive}
                locked={skill.alwaysActive}
                disabled={disabled}
                onChange={onToggle}
            />
        </div>
    );
}

function SkillSection({
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
                <span className="text-xs text-muted-foreground tabular-nums">
                    {count}
                </span>
            </div>
            {!collapsed && children}
        </div>
    );
}

export function CapabilitiesTab({ agent }: { agent: SerializedAgent }) {
    const dispatch = useAppDispatch();
    const skillsMap = useAppSelector(selectAllSkills);
    const skillsLoading = useAppSelector(selectSkillsLoading);
    const myRole = useMyContentRole(ContentType.AGENT, agent.id, agent.userRole);
    const canEdit = roleCanEdit(myRole);

    const skills = useMemo(() => Object.values(skillsMap), [skillsMap]);

    useEffect(() => {
        dispatch(fetchSkills());
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const enabledTools = useMemo(
        () => new Set(agent.enabledTools),
        [agent.enabledTools]
    );

    const sectionCounts = useMemo(() => {
        const counts: Record<string, { enabled: number; total: number }> = {};
        for (const section of TOOL_SECTIONS) {
            let total = 0;
            let enabled = 0;
            for (const group of section.groups) {
                total += group.tools.length;
                enabled += group.tools.filter((t) => enabledTools.has(t.name)).length;
            }
            counts[section.category] = { enabled, total };
        }
        return counts;
    }, [enabledTools]);

    const handleToolToggle = useCallback(
        (toolName: string, enabled: boolean) => {
            const updated = enabled
                ? [...agent.enabledTools, toolName]
                : agent.enabledTools.filter((t) => t !== toolName);
            dispatch(updateAgent({ agentId: agent.id, enabledTools: updated }));
        },
        [agent.id, agent.enabledTools, dispatch]
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
            dispatch(
                updateAgent({ agentId: agent.id, enabledTools: [...current] })
            );
        },
        [agent.id, agent.enabledTools, dispatch]
    );

    const enabledSkillIds = useMemo(
        () => new Set(agent.enabledSkills),
        [agent.enabledSkills]
    );

    const bundledSkills = useMemo(
        () => skills.filter((s) => s.source === SkillSource.BUNDLED),
        [skills]
    );
    const orgSkills = useMemo(
        () => skills.filter((s) => s.source === SkillSource.ORGANIZATION),
        [skills]
    );

    const handleSkillToggle = useCallback(
        (skillId: string) => {
            const updated = enabledSkillIds.has(skillId)
                ? agent.enabledSkills.filter((id) => id !== skillId)
                : [...agent.enabledSkills, skillId];
            dispatch(updateAgent({ agentId: agent.id, enabledSkills: updated }));
        },
        [agent.id, agent.enabledSkills, enabledSkillIds, dispatch]
    );

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            {TOOL_SECTIONS.map((section) => {
                const counts = sectionCounts[section.category] ?? { enabled: 0, total: 0 };
                return (
                    <ToolCategory
                        key={section.category}
                        section={section}
                        enabledTools={enabledTools}
                        enabledCount={counts.enabled}
                        totalCount={counts.total}
                        disabled={!canEdit}
                        onToggle={handleToolToggle}
                        onToggleAll={handleToolToggleAll}
                    />
                );
            })}

            <section>
                <div className="mb-2">
                    <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
                        Skills
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                        Configure which skills this agent can use
                    </p>
                </div>

                {skillsLoading && skills.length === 0 ? (
                    <div className="flex items-center justify-center py-12">
                        <CircleNotch size={24} className="animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <div className="space-y-4">
                        <SkillSection title="Bundled" count={bundledSkills.length}>
                            <div>
                                {bundledSkills.map((skill) => (
                                    <SkillRow
                                        key={skill.id}
                                        skill={skill}
                                        enabled={enabledSkillIds.has(skill.id)}
                                        disabled={!canEdit}
                                        onToggle={() => handleSkillToggle(skill.id)}
                                    />
                                ))}
                                {bundledSkills.length === 0 && (
                                    <p className="py-2 text-sm text-muted-foreground">
                                        No bundled skills available
                                    </p>
                                )}
                            </div>
                        </SkillSection>

                        <SkillSection title="Organization" count={orgSkills.length}>
                            <div>
                                {orgSkills.map((skill) => (
                                    <SkillRow
                                        key={skill.id}
                                        skill={skill}
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
                        </SkillSection>
                    </div>
                )}
            </section>
        </div>
    );
}
